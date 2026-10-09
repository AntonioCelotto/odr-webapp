const normalized = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
export function trainingOrderItems(order, products = [], mappings = []) {
  return (order.items || []).filter(item => {
    const product = products.find(p => Number(p.id) === Number(item.productId));
    const sku = normalized(item.sku || product?.sku);
    const name = normalized(item.name);
    // Legacy orders may no longer have a SKU after the product was removed.
    // Name matching is only for the order list; grants still require a product mapping.
    return sku === 'ODR1' || name === 'VIDEO CORSO DI FORMAZIONE'
      || name === 'ODR1 VIDEO CORSO DI FORMAZIONE'
      || mappings.some(m => Number(m.product_id) === Number(item.productId));
  });
}
export function orderClient(order) {
  return order ? {
    name: order.customerCompany || order.center || order.customer || 'Cliente',
    contact: order.customer || '', email: order.customerEmail || '', phone: order.customerPhone || '',
    address: order.shippingAddress || '',
  } : null;
}
export function availableBatches(accesses, courses) {
  const batches = new Map();
  for (const access of accesses) {
    if (!access.active || access.recipient_email || !courses.some(c => c.id === access.course_id && c.active)) continue;
    const key = [access.owner_id, access.course_id, access.source_order, access.product_id].join(':');
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(access);
  }
  return [...batches.values()];
}
