<?php
/** ODR in-app BACS checkout. Install as a standalone Code Snippets snippet. */
add_action('rest_api_init', function () {
    register_rest_route('odr/v1', '/bank-checkout', array(
        'methods' => 'POST',
        'permission_callback' => function (WP_REST_Request $r) {
            if (!function_exists('wc_api_hash')) return false;
            $key = (string) $r->get_param('consumer_key');
            $secret = (string) $r->get_param('consumer_secret');
            if (!$key || !$secret) return false;
            global $wpdb;
            $row = $wpdb->get_row($wpdb->prepare("SELECT user_id, consumer_secret, permissions FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s", wc_api_hash($key)));
            return $row && in_array($row->permissions, array('write','read_write'), true)
                && user_can($row->user_id, 'manage_woocommerce') && hash_equals((string) $row->consumer_secret, $secret);
        },
        'callback' => 'odr_bank_checkout_request',
    ));
});

function odr_bank_checkout_bank() {
    $gateway = WC()->payment_gateways()->payment_gateways()['bacs'] ?? null;
    if (!$gateway || 'yes' !== $gateway->enabled) throw new Exception('Bonifico bancario non disponibile');
    return array('instructions' => wp_strip_all_tags($gateway->instructions), 'accounts' => array_values((array) get_option('woocommerce_bacs_accounts', array())));
}

function odr_bank_checkout_cart($data) {
    // Request-local session: do not init/load/save cookies or persistent customer carts.
    add_filter('woocommerce_persistent_cart_enabled', '__return_false', PHP_INT_MAX);
    WC()->session = new WC_Session_Handler();
    $user = get_user_by('email', $data['customer_email']);
    $actor = get_user_by('email', $data['actor_email']);
    wp_set_current_user($actor ? $actor->ID : 0);
    WC()->customer = new WC_Customer($user ? $user->ID : 0);
    foreach (array('billing','shipping') as $type) {
        foreach ($data[$type] as $field => $value) {
            $setter = 'set_' . $type . '_' . $field;
            if (is_callable(array(WC()->customer, $setter))) WC()->customer->{$setter}(wc_clean($value));
        }
    }
    WC()->customer->set_calculated_shipping(true);
    WC()->cart = new WC_Cart();
    wc_clear_notices();
    $allowed = array(
        'agent' => array('prodotti','prodotti-2','pacchetti-promozionali','2-linea-professional','merchandising'),
        'distributor' => array('confezione_distributore','pacchetti-promozionali','merchandising'),
        'center' => array('prodotti','prodotti-2','pacchetti-promozionali','2-linea-retail','2-linea-retail-pf'),
    );
    foreach ($data['items'] as $item) {
        $product = wc_get_product($item['product_id']);
        if (!$product || !$product->is_purchasable() || !$product->is_in_stock()) throw new Exception('Prodotto non disponibile');
        $slugs = wp_get_post_terms($product->get_id(),'product_cat',array('fields'=>'slugs'));
        if (is_wp_error($slugs)) throw new Exception('Categorie non disponibili');
        $ok = count(array_intersect($allowed[$data['role']] ?? array(), $slugs)) > 0;
        if (in_array($data['role'], array('agent','distributor'), true)) {
            foreach ($slugs as $slug) if (preg_match('/^(3-promo-|promo-|5-mkt-|6-mkt-|7-mkt-)/',$slug)) $ok = true;
        }
        if (!$ok) throw new Exception('Prodotto non disponibile per il profilo');
        if (!WC()->cart->add_to_cart($product->get_id(), $item['quantity'])) throw new Exception('Quantità non disponibile');
    }
    if (!empty($data['coupon']) && !WC()->cart->apply_coupon($data['coupon'])) throw new Exception('Codice promozionale non valido per questo ordine');
    WC()->cart->calculate_totals();
    $packages = WC()->shipping()->get_packages();
    $choices = array(); $selected = array();
    foreach ($packages as $index => $package) {
        $rates = $package['rates'] ?? array();
        if (!$rates) throw new Exception('Nessuna spedizione disponibile per questo indirizzo');
        $pick = $data['shipping_methods'][$index] ?? array_key_first($rates);
        if (!isset($rates[$pick])) throw new Exception('Metodo di spedizione non più disponibile');
        $selected[$index] = $pick;
        $choices[] = array_map(function ($rate) {
            return array('id'=>$rate->get_id(), 'label'=>$rate->get_label(), 'total'=>round((float)$rate->get_cost() + array_sum($rate->get_taxes()), wc_get_price_decimals()));
        }, array_values($rates));
    }
    if (WC()->cart->needs_shipping() && !$packages) throw new Exception('Calcolo spedizione non disponibile');
    WC()->session->set('chosen_shipping_methods', $selected);
    WC()->cart->calculate_totals();
    if (!isset(WC()->payment_gateways()->get_available_payment_gateways()['bacs'])) throw new Exception('Bonifico non disponibile per questo ordine');
    WC()->checkout()->check_cart_items();
    if (wc_notice_count('error')) {
        $errors = wc_get_notices('error');
        throw new Exception(wp_strip_all_tags($errors[0]['notice']));
    }
    $lines = array();
    foreach (WC()->cart->get_cart() as $line) {
        $lines[] = array('id'=>$line['product_id'], 'name'=>$line['data']->get_name(), 'quantity'=>$line['quantity'], 'total'=>wc_format_decimal($line['line_total'], wc_get_price_decimals()), 'tax'=>wc_format_decimal($line['line_tax'], wc_get_price_decimals()));
    }
    return array('lines'=>$lines, 'subtotal'=>WC()->cart->get_subtotal(), 'discount'=>WC()->cart->get_discount_total(),
        'shipping'=>WC()->cart->get_shipping_total(), 'tax'=>WC()->cart->get_total_tax(), 'fees'=>WC()->cart->get_fee_total(),
        'total'=>WC()->cart->get_total('edit'), 'currency'=>get_woocommerce_currency(), 'shippingOptions'=>$choices, 'shippingMethods'=>array_values($selected), 'bank'=>odr_bank_checkout_bank());
}

function odr_bank_checkout_result($order) {
    return array('orderId'=>$order->get_id(), 'orderNumber'=>$order->get_order_number(), 'status'=>$order->get_status(), 'total'=>$order->get_total(), 'currency'=>$order->get_currency(), 'bank'=>odr_bank_checkout_bank());
}

function odr_bank_checkout_request(WP_REST_Request $r) {
    $lock = ''; $locked = false;
    try {
        $actor = sanitize_text_field($r['actor_id']);
        if (!$actor) throw new Exception('Profilo mancante');
        if ('quote' === $r['action']) {
            $data = array();
            foreach (array('actor_id','role','actor_name','entity_id','actor_email','customer_reference','customer_email','billing','shipping','payment_terms','items','coupon','shipping_methods') as $field) $data[$field] = $r[$field];
            if (!in_array($data['role'],array('agent','distributor','center'),true) || !is_array($data['items']) || !count($data['items']) || count($data['items']) > 50) throw new Exception('Carrello non valido');
            foreach ($data['items'] as $item) if (empty($item['product_id']) || !is_int($item['quantity']) || $item['quantity'] < 1 || $item['quantity'] > 99) throw new Exception('Quantità non valida');
            foreach (array('billing','shipping') as $type) {
                if (!is_array($data[$type])) throw new Exception('Indirizzo mancante');
                foreach (array('first_name','last_name','address_1','city','postcode','country','state') as $field) if (empty($data[$type][$field])) throw new Exception('Indirizzo incompleto');
                if (!WC_Validation::is_postcode($data[$type]['postcode'],$data[$type]['country'])) throw new Exception('CAP non valido');
            }
            if (!is_email($data['customer_email'])) throw new Exception('Email non valida');
            $summary = odr_bank_checkout_cart($data);
            $data['shipping_methods'] = $summary['shippingMethods'];
            $token = bin2hex(random_bytes(32));
            set_transient('odr_bq_' . $token, array('data'=>$data, 'summary'=>$summary), 15 * MINUTE_IN_SECONDS);
            $summary['quoteToken'] = $token;
            return rest_ensure_response($summary);
        }
        $token = (string) $r['quote_token'];
        if ('confirm' !== $r['action'] || !preg_match('/^[a-f0-9]{64}$/',$token)) throw new Exception('Riepilogo non valido');
        $key = hash('sha256', $actor . ':' . $token);
        $done = get_option('odr_bo_' . $key);
        if ($done) {
            $existing = wc_get_order($done);
            if (!$existing) throw new Exception('Ordine da verificare con amministrazione');
            if ($existing->has_status('pending')) $existing->update_status('on-hold','Ordine ODR: in attesa di bonifico bancario.');
            return rest_ensure_response(odr_bank_checkout_result($existing));
        }
        $quote = get_transient('odr_bq_' . $token);
        if (!$quote || $quote['data']['actor_id'] !== $actor) return new WP_Error('quote_expired','Riepilogo scaduto. Ricalcola il totale.',array('status'=>409));
        // Atomic durable lock; deliberately never expire a lock after an uncertain write.
        $lock = 'odr_bl_' . $key;
        $locked = add_option($lock, time(), '', false);
        if (!$locked) return new WP_Error('order_in_progress','Conferma già in corso. Riprova tra pochi secondi.',array('status'=>409));
        $data = $quote['data'];
        $summary = odr_bank_checkout_cart($data);
        if (wp_json_encode($summary) !== wp_json_encode($quote['summary'])) return new WP_Error('quote_changed','Prezzi o spedizione sono cambiati. Ricalcola prima di confermare.',array('status'=>409));
        $posted = array('payment_method'=>'bacs','ship_to_different_address'=>1,'terms'=>1,'createaccount'=>0,'shipping_method'=>$summary['shippingMethods']);
        foreach (array('billing','shipping') as $type) foreach ($data[$type] as $field=>$value) $posted[$type.'_'.$field] = wc_clean($value);
        $customer = get_user_by('email', $data['customer_email']);
        add_filter('woocommerce_checkout_customer_id', function () use ($customer) { return $customer ? $customer->ID : 0; });
        // Store attribution before WooCommerce persists the new order and fires its hooks.
        add_action('woocommerce_checkout_create_order', function ($order) use ($data,$key) {
            $order->set_created_via('odr-bank-app');
            $order->update_meta_data('_odr_bank_request', $key);
            $order->update_meta_data('_odr_customer_reference',$data['customer_reference']);
            $order->update_meta_data('_odr_payment_terms',implode(',', (array)$data['payment_terms']));
            if (in_array($data['role'],array('agent','distributor'),true)) {
                $order->update_meta_data('_odr_agent_profile_id',$data['actor_id']);
                $order->update_meta_data('_odr_agent_entity_id',$data['entity_id']);
                $order->update_meta_data('_odr_agent_name',$data['actor_name']);
            }
        });
        // From this point a crash must not allow creating a second order for this quote.
        $locked = false;
        $id = WC()->checkout()->create_order($posted);
        if (is_wp_error($id)) return $id; // Preserve lock: a plugin may fail after the order was persisted.
        $order = wc_get_order($id);
        if (!$order) throw new Exception('Conferma da verificare con amministrazione');
        update_option('odr_bo_' . $key, $id, false);
        do_action('woocommerce_checkout_order_processed', $id, $posted, $order);
        // BACS means unpaid: on-hold triggers WooCommerce stock, coupon and email hooks.
        $order->update_status('on-hold','Ordine ODR: in attesa di bonifico bancario.');
        delete_option($lock);
        return rest_ensure_response(odr_bank_checkout_result($order));
    } catch (Throwable $e) {
        return new WP_Error('bank_checkout_error',wp_strip_all_tags($e->getMessage()),array('status'=>400));
    } finally {
        if ($locked && $lock) delete_option($lock);
    }
}
