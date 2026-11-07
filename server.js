const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch { return fallback; } };
const write = (file, value) => fs.writeFileSync(path.join(DATA, file), JSON.stringify(value, null, 2));
const categories = ['Bats','Batting Gloves','Batting Pads','Guard','Wicketkeeping','Helmets','Caps','Kit Bag','Shoes'];
const names = {
  'Bats':['BA 56 English Willow Bat','BA 56 Kings Edition Bat','BA 56 Players Edition Bat','CA Gold 1000 Bat','CA Gold 10000 Bat','CA Plus 15000 Bat','Junior Cricket Bat'],
  'Batting Gloves':['Grey Nicolls Legend Batting Gloves','Grey Nicolls Max Batting Gloves','CP Player Edition Batting Gloves','HS Y10K Batting Gloves','CA Gold Batting Gloves','Junior Batting Gloves','Club Match Batting Gloves'],
  'Batting Pads':['Grey Nicolls Legend Batting Pad','HS Y10K Batting Pad','MRF Wicket Keeping Pad','Spartan Batting Pad','CA Gold Batting Pad','Junior Batting Pads','Club Match Batting Pads'],
  'Guard':['Arm Guard','SG Abdominal Guard','GM Abdominal Guard','Chest Guard','Pro Elbow Guard','Junior Abdominal Guard','Premium Protection Guard'],
  'Wicketkeeping':['Grey Nicolls Moulded Thigh Guard','Grey Nicolls Fielding Shin Guard','Moon Walker Double Thigh Guard','Grey Nicolls P1 Double Thigh Guard','Pro Thigh Guard','Fibre Wicket Set','Wicket Keeping Inner Gloves'],
  'Helmets':['Pro Cricket Helmet','Club Cricket Helmet','Junior Cricket Helmet','Steel Grill Cricket Helmet','Premium Lightweight Helmet','Training Cricket Helmet','Classic Cricket Helmet','Pro Visor Helmet'],
  'Caps':['Classic Cricket Cap','Team Training Cap','Performance Cricket Cap'],
  'Kit Bag':['18K Duffle Bag','18K Duffle Weekly Bag','CA Sports Cricket Kit Bag','Pro Cricket Wheelie Bag','Club Cricket Kit Bag','Junior Cricket Kit Bag','Bat Carry Bag'],
  'Shoes':['Adoral Cricket Shoes','Club Grip Cricket Shoes','Lightweight Training Cricket Shoes','Junior Cricket Shoes','Pro Spike Cricket Shoes','All-Rounder Cricket Shoes','Match-Day Cricket Shoes']
};
const prices = {'Bats':[6500,155000],'Batting Gloves':[1800,6500],'Batting Pads':[1800,7500],'Guard':[500,1800],'Wicketkeeping':[800,3000],'Helmets':[3000,7500],'Caps':[700,1200],'Kit Bag':[1200,12000],'Shoes':[3500,9500]};
function seedProducts() {
  const existing = read('products.json', null); if (existing && existing.length) return existing;
  let id = 1; const items = [];
  for (const category of categories) {
    names[category].forEach((name, index) => {
      const [low, high] = prices[category];
      const price = Math.round((low + (high-low) * ((index % 5) / 4)) / 50) * 50;
      const product = { id: id++, name, category, subcategory: category === 'Bats' ? (index % 2 ? 'Kashmir Willow' : 'English Willow') : '', price, stock: 4 + ((index * 7) % 23), description: `Reliable ${category.toLowerCase()} equipment designed for practice sessions and match-day performance.`, image: '', featured: index < 2 };
      items.push(product);
    });
  }
  write('products.json', items); return items;
}
seedProducts();
if (!fs.existsSync(path.join(DATA,'orders.json'))) write('orders.json', []);
if (!fs.existsSync(path.join(DATA,'users.json'))) write('users.json', []);
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(ROOT, 'public')));
const sessions = new Map();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'abd';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123123123';
function admin(req,res,next) { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,''); if (!token || !sessions.has(token)) return res.status(401).json({error:'Please sign in as administrator.'}); req.admin = true; next(); }
app.get('/api/products', (req,res) => res.json(read('products.json', [])));
app.post('/api/orders', (req,res) => {
  const { customer, items, shippingMethod } = req.body || {};
  if (!customer || !customer.firstName || !customer.lastName || !customer.phone || !customer.address || !Array.isArray(items) || !items.length) return res.status(400).json({error:'Please complete the required checkout fields.'});
  const products = read('products.json', []); const clean = [];
  for (const line of items) {
    const p = products.find(x => x.id === Number(line.id)); const qty = Math.floor(Number(line.quantity));
    if (!p || !Number.isFinite(qty) || qty < 1) return res.status(400).json({error:'Invalid product or quantity.'});
    if (p.stock < qty) return res.status(400).json({error:`Only ${p.stock} left in stock for ${p.name}.`});
    clean.push({id:p.id, name:p.name, category:p.category, price:p.price, quantity:qty, size:String(line.size || ''), colour:String(line.colour || '')});
  }
  const requestedByProduct = new Map(); clean.forEach(line => requestedByProduct.set(line.id, (requestedByProduct.get(line.id) || 0) + line.quantity));
  for (const [id, qty] of requestedByProduct) { const p = products.find(x => x.id === id); if (!p || p.stock < qty) return res.status(400).json({error:`Only ${p ? p.stock : 0} left in stock for ${p ? p.name : 'that product'}.`}); }
  clean.forEach(line => { const p = products.find(x => x.id === line.id); p.stock -= line.quantity; });
  write('products.json', products);
  const subtotal = clean.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const shipping = subtotal >= 10000 ? 0 : 350; const total = subtotal + shipping;
  const orders = read('orders.json', []); const order = { id: 'ABH-' + Date.now().toString().slice(-8), createdAt: new Date().toISOString(), customer, items: clean, subtotal, shipping, total, shippingMethod: shippingMethod || 'Cash on Delivery', status:'Pending' };
  orders.unshift(order); write('orders.json', orders); res.status(201).json({message:'Order placed successfully!', orderId:order.id, total});
});
app.post('/api/orders/track', (req,res) => { const {orderId, phone} = req.body || {}; if(!orderId || !phone) return res.status(400).json({error:'Enter both your order reference and checkout phone number.'}); const order = read('orders.json', []).find(o => o.id.toLowerCase() === String(orderId).toLowerCase() && String(o.customer.phone).replace(/\s/g,'') === String(phone).replace(/\s/g,'')); if(!order) return res.status(404).json({error:'We could not find an order matching those details.'}); res.json({id:order.id,createdAt:order.createdAt,status:order.status,total:order.total,items:order.items}); });
app.post('/api/admin/login', (req,res) => { const {username,password} = req.body || {}; if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return res.status(401).json({error:'Incorrect administrator email or password.'}); const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, true); res.json({token, message:'Signed in successfully.'}); });
app.get('/api/admin/summary', admin, (req,res) => { const products=read('products.json',[]), orders=read('orders.json',[]); res.json({products,orders,stats:{products:products.length,orders:orders.length,revenue:orders.reduce((s,o)=>s+o.total,0),lowStock:products.filter(p=>p.stock<5).length}}); });
function saveProductImage(image) {
  if (typeof image !== 'string' || !image.trim()) return '';
  const data = image.trim().match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
  if (!data) return image.trim().slice(0,2000);
  const buffer = Buffer.from(data[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
  const ext = ({jpeg:'jpg',jpg:'jpg',png:'png',webp:'webp',gif:'gif'})[data[1].toLowerCase()];
  const uploadDir = path.join(ROOT, 'public', 'uploads'); fs.mkdirSync(uploadDir, {recursive:true});
  const filename = 'product-' + crypto.randomBytes(10).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return '/uploads/' + filename;
}
function cleanOptions(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v=>String(v).trim()).filter(Boolean))].slice(0,30);
  if (typeof value === 'string') return [...new Set(value.split(',').map(v=>v.trim()).filter(Boolean))].slice(0,30);
  return [];
}
app.put('/api/admin/products/:id', admin, (req,res) => {
  const products=read('products.json',[]); const p=products.find(x=>x.id===Number(req.params.id));
  if(!p) return res.status(404).json({error:'Product not found.'});
  const b=req.body||{};
  if(b.name!==undefined){if(!String(b.name).trim())return res.status(400).json({error:'Product name is required.'});p.name=String(b.name).trim();}
  if(b.category!==undefined && categories.includes(b.category))p.category=b.category;
  if(b.subcategory!==undefined)p.subcategory=String(b.subcategory).trim();
  if(b.price!==undefined && Number.isFinite(Number(b.price)) && Number(b.price)>=0)p.price=Number(b.price);
  if(b.stock!==undefined && Number.isInteger(Number(b.stock)) && Number(b.stock)>=0)p.stock=Number(b.stock);
  if(b.description!==undefined)p.description=String(b.description).trim();
  if(b.image!==undefined){try{p.image=saveProductImage(b.image);}catch(e){return res.status(400).json({error:e.message});}}
  if(b.colours!==undefined)p.colours=cleanOptions(b.colours);
  if(b.sizes!==undefined)p.sizes=cleanOptions(b.sizes);
  if(b.featured!==undefined)p.featured=Boolean(b.featured);
  write('products.json',products); res.json(p);
});
app.post('/api/admin/products', admin, (req,res) => {
  const b=req.body||{};
  if(!String(b.name||'').trim()||!categories.includes(b.category)||!Number.isFinite(Number(b.price))||Number(b.price)<0||!Number.isInteger(Number(b.stock))||Number(b.stock)<0)return res.status(400).json({error:'Enter a product name, valid category, price and whole-number stock quantity.'});
  let image='';try{image=saveProductImage(b.image||'');}catch(e){return res.status(400).json({error:e.message});}
  const products=read('products.json',[]); const p={id:Math.max(0,...products.map(x=>x.id))+1,name:String(b.name).trim(),category:b.category,subcategory:String(b.subcategory||'').trim(),price:Number(b.price),stock:Number(b.stock),description:String(b.description||'').trim(),image,featured:Boolean(b.featured),colours:cleanOptions(b.colours),sizes:cleanOptions(b.sizes)};
  products.push(p); write('products.json',products); res.status(201).json(p);
});
app.delete('/api/admin/products/:id', admin, (req,res) => { const products=read('products.json',[]); const next=products.filter(x=>x.id!==Number(req.params.id)); if(next.length===products.length)return res.status(404).json({error:'Product not found.'}); write('products.json',next); res.json({message:'Product removed.'}); });
app.patch('/api/admin/orders/:id', admin, (req,res) => { const allowed=['Pending','Confirmed','Packed','Shipped','Delivered','Cancelled']; const orders=read('orders.json',[]); const o=orders.find(x=>x.id===req.params.id); if(!o)return res.status(404).json({error:'Order not found.'}); if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid order status.'}); o.status=req.body.status; write('orders.json',orders); res.json(o); });
app.listen(PORT, () => console.log(`ABH SPORTS is running at http://localhost:${PORT}`));
