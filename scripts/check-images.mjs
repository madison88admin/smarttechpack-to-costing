// Try common NextGen image endpoints
const base = 'https://nextgen.madison88.com';
const productId = '327';
const endpoints = [
  `/Product/GetImage/${productId}`,
  `/api/product/${productId}/image`,
  `/Product/Image/${productId}`,
  `/Product/GetProductImage/${productId}`,
  `/Image/Get/${productId}`,
  `/Product/GetById/${productId}`,
  `/ProductManagerProductsGrid/GetImage?id=${productId}`,
];

for (const ep of endpoints) {
  try {
    const r = await fetch(base + ep, { redirect: 'follow' });
    const contentType = r.headers.get('content-type') || '';
    console.log(`${ep} → ${r.status} ${contentType.slice(0, 50)}`);
    if (contentType.startsWith('image/')) {
      console.log('  *** IMAGE FOUND! ***');
    }
  } catch (e) {
    console.log(`${ep} → ERROR: ${e.message}`);
  }
}
