<?php
/**
 * Send the native WooCommerce New Order summary after a submitted checkout,
 * including pending orders created by the ODR agent app.
 * Recipients are configured in WooCommerce > Settings > Emails > New order:
 * odr.ordini@ita318.it, info@spezialilaurenziani.it
 * The native _new_order_email_sent flag prevents a second automatic summary
 * on later status changes. Existing orders are never scanned or resent.
 */
function odr_notify_submitted_order_20260922( $order_or_id ) {
    $order = $order_or_id instanceof WC_Order ? $order_or_id : wc_get_order( $order_or_id );
    if ( ! $order || ! $order->has_status( array( 'pending', 'on-hold', 'processing', 'completed' ) ) || $order->get_new_order_email_sent() ) {
        return;
    }
    try {
        $emails = WC()->mailer()->get_emails();
        if ( isset( $emails['WC_Email_New_Order'] ) ) {
            $emails['WC_Email_New_Order']->trigger( $order->get_id(), $order );
        }
    } catch ( Throwable $error ) {
        wc_get_logger()->error( 'New order email failed for order ' . $order->get_id(), array( 'source' => 'odr-order-notifications' ) );
    }
}

add_action( 'woocommerce_checkout_order_processed', 'odr_notify_submitted_order_20260922', 30, 1 );
add_action( 'woocommerce_store_api_checkout_order_processed', 'odr_notify_submitted_order_20260922', 30, 1 );
add_action( 'woocommerce_rest_insert_shop_order_object', function ( $order, $request, $creating ) {
    if ( $creating && $order instanceof WC_Order && 'odr-agent-app' === $order->get_created_via() ) {
        odr_notify_submitted_order_20260922( $order );
    }
}, 30, 3 );
