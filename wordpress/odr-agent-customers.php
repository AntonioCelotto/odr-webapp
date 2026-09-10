/**
 * ODR - espone alla webapp i clienti assegnati a un agente.
 * L'autenticazione usa le stesse chiavi REST WooCommerce della webapp.
 */
add_action( 'rest_api_init', function () {
    register_rest_route( 'wc/v3', '/odr-agent-customers', array(
        'methods'             => WP_REST_Server::READABLE,
        'permission_callback' => function () {
            return current_user_can( 'manage_woocommerce' );
        },
        'callback'            => 'odr_rest_agent_customers',
        'args'                => array(
            'agent_id' => array(
                'required'          => true,
                'sanitize_callback' => 'absint',
            ),
        ),
    ) );
} );

function odr_normalize_agent_identity( $value ) {
    $value = remove_accents( wp_strip_all_tags( (string) $value ) );
    $value = preg_replace( '/\s+/', ' ', trim( $value ) );
    return strtolower( $value );
}

function odr_rest_agent_customers( WP_REST_Request $request ) {
    $agent_id = absint( $request->get_param( 'agent_id' ) );
    $agent    = get_userdata( $agent_id );
    if ( ! $agent ) {
        return new WP_Error( 'odr_agent_not_found', 'Agente non trovato.', array( 'status' => 404 ) );
    }

    $identities = array_filter( array_unique( array_map( 'odr_normalize_agent_identity', array(
        $agent->display_name,
        $agent->user_login,
        $agent->user_email,
        trim( $agent->first_name . ' ' . $agent->last_name ),
    ) ) ) );

    $customer_ids = get_users( array(
        'fields'     => 'ID',
        'number'     => -1,
        'meta_query' => array(
            'relation' => 'OR',
            array(
                'key'     => 'agente_wp_user_id',
                'value'   => $agent_id,
                'compare' => '=',
            ),
            array(
                'key'     => 'nome_agente',
                'compare' => 'EXISTS',
            ),
        ),
    ) );

    $customers = array();
    foreach ( $customer_ids as $customer_id ) {
        $assigned_id   = absint( get_user_meta( $customer_id, 'agente_wp_user_id', true ) );
        $assigned_name = odr_normalize_agent_identity( get_user_meta( $customer_id, 'nome_agente', true ) );
        if ( $assigned_id && $assigned_id !== $agent_id ) {
            continue;
        }
        if ( ! $assigned_id && ! in_array( $assigned_name, $identities, true ) ) {
            continue;
        }

        if ( ! $assigned_id ) {
            update_user_meta( $customer_id, 'agente_wp_user_id', $agent_id );
        }
        $customer = get_userdata( $customer_id );
        $customers[] = array(
            'id'    => (int) $customer_id,
            'email' => $customer ? $customer->user_email : '',
        );
    }

    return rest_ensure_response( array(
        'agent_id' => $agent_id,
        'count'    => count( $customers ),
        'customers'=> $customers,
    ) );
}
