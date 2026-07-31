<?php

add_filter( 'rest_request_after_callbacks', function ( $response, $handler, WP_REST_Request $request ) {
    if ( '/odr/v1/session' !== $request->get_route() || 'POST' !== $request->get_method() || is_wp_error( $response ) ) {
        return $response;
    }

    $data = rest_ensure_response( $response )->get_data();
    if ( empty( $data['url'] ) ) {
        return $response;
    }

    $query = array();
    parse_str( (string) wp_parse_url( $data['url'], PHP_URL_QUERY ), $query );
    $token = sanitize_text_field( $query['odr_sso'] ?? '' );
    if ( ! $token ) {
        return $response;
    }

    $transient_key = 'odr_sso_' . hash( 'sha256', $token );
    $session = get_transient( $transient_key );
    if ( ! is_array( $session ) || empty( $session['user_id'] ) ) {
        return $response;
    }

    $requested_address = $request->get_param( 'address' );
    if ( is_array( $requested_address ) && class_exists( 'WC_Customer' ) ) {
        $limits = array(
            'first_name' => 60, 'last_name' => 60, 'company' => 120,
            'address_1' => 160, 'address_2' => 160, 'postcode' => 20,
            'city' => 100, 'state' => 10, 'country' => 2,
            'phone' => 40, 'email' => 200,
        );
        $address = array();
        foreach ( $limits as $field => $length ) {
            $address[ $field ] = substr( sanitize_text_field( $requested_address[ $field ] ?? '' ), 0, $length );
        }
        $address['country'] = strtoupper( $address['country'] ?: 'IT' );
        $address['state'] = strtoupper( $address['state'] );

        $customer = new WC_Customer( (int) $session['user_id'], true );
        $billing_fields = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'postcode', 'city', 'state', 'country', 'phone', 'email' );
        $shipping_fields = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'postcode', 'city', 'state', 'country' );
        foreach ( $billing_fields as $field ) {
            $setter = 'set_billing_' . $field;
            if ( is_callable( array( $customer, $setter ) ) ) {
                $customer->{$setter}( $address[ $field ] ?? '' );
            }
        }
        foreach ( $shipping_fields as $field ) {
            $setter = 'set_shipping_' . $field;
            if ( is_callable( array( $customer, $setter ) ) ) {
                $customer->{$setter}( $address[ $field ] ?? '' );
            }
        }
        $customer->save();
        $session['address'] = $address;
    }

    if ( $request->get_param( 'checkout' ) ) {
        $session['redirect'] = wc_get_checkout_url();
    }
    set_transient( $transient_key, $session, 90 );
    return $response;
}, 20, 3 );
