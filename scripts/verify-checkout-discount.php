<?php
// Isolated unit checks: no WordPress calls, orders or network writes.
function add_action(...$args) {}
function wc_get_price_decimals() { return 2; }
class FakeCart {
    public $net = 510; public $fees = array(); public $lines = array(); public $added;
    function get_cart_contents_total() { return $this->net; }
    function get_fees() { return $this->fees; }
    function fees_api() { return $this; }
    function add_fee($fee) { $this->added=$fee; }
    function get_cart() { return $this->lines; }
}
class FakeProduct {
    function __construct(public $tax_class) {}
    function is_taxable() { return $this->tax_class !== 'exempt'; }
    function get_tax_class() { return $this->tax_class; }
}
class FakeCustomer { public $exempt=false; function get_is_vat_exempt(){return $this->exempt;} }
class WC_Tax {
    static function get_rates($class,$customer) { return array($class===''?'standard':'reduced'=>$class===''?0.22:0.1); }
    static function calc_tax($amount,$rates,$inclusive=false) { return array_map(fn($rate)=>$amount*$rate,$rates); }
}
$wc=(object) array('cart'=>new FakeCart(),'customer'=>new FakeCustomer());
function WC() { global $wc; return $wc; }
function check($value,$expected) { if (abs($value-$expected)>0.00001) throw new Exception("Expected $expected, got $value"); }
// Load implementation after stubs.
require __DIR__.'/../wordpress/odr-bank-checkout.php';
$wc->cart->fees=array((object)array('id'=>'role','amount'=>-255),(object)array('id'=>'handling','amount'=>10));
odr_bank_checkout_advance_fee($wc->cart); check($wc->cart->added['amount'],-7.65);
$wc->cart->net=100;$wc->cart->fees=array();odr_bank_checkout_advance_fee($wc->cart);check($wc->cart->added['amount'],-3);
$wc->cart->lines=array(array('line_total'=>50,'data'=>new FakeProduct('')),array('line_total'=>50,'data'=>new FakeProduct('reduced')));
$fee=(object)array('object'=>(object)array('id'=>'odr-advance-discount'),'total'=>-300);
$taxes=odr_bank_checkout_advance_taxes(array(),$fee);check($taxes['standard'],-33);check($taxes['reduced'],-15);
$wc->customer->exempt=true;if(odr_bank_checkout_advance_taxes(array(),$fee)!==array())throw new Exception('Exemption');
foreach(array(30,60,90) as $days)check(odr_bank_checkout_payment('bacs_'.$days)['days'],$days);
if(odr_bank_checkout_payment('cod')['gateway']!=='cod')throw new Exception('COD');
echo "PHP discount: net product base, role discounts, mixed VAT, VAT exemption and payment terms OK\n";
