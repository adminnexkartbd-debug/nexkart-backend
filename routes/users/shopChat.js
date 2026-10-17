'use strict';
// Rule-based catalogue assistant: no external AI, session chat history or new tables.
const digits=s=>String(s||'').replace(/[০-৯]/g,x=>String('০১২৩৪৫৬৭৮৯'.indexOf(x)));
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const groups=[
 ['face wash',/face\s*wash|facewash|ফেস\s*ও[য়য়]াশ/i,['face wash','facewash','cleanser']],
 ['serum',/serum|সিরাম/i,['serum']],['soap',/soap|সাবান/i,['soap']],
 ['sunscreen',/sunscreen|sun\s*screen|সানস্ক্রিন/i,['sunscreen','sun screen','spf']],
 ['moisturizer',/moisturi[sz]er|ম[য়য়]েশ্চারাইজার/i,['moisturizer','moisturiser']],
 ['skincare',/skin\s*care|skincare|স্কিন\s*কে[য়য়]ার|স্কিনকেয়ার/i,['skin','serum','soap','cleanser','moistur','sunscreen','cream']],
 ['electronics',/electronics?|ইলেকট্রনিক/i,['electronics']],['fashion',/fashion|ফ্যাশন/i,['fashion']],
 ['makeup',/make\s*up|মেকআপ/i,['makeup','lipstick','mascara','foundation']],['hair care',/hair\s*care|হে[য়য়]ার|শ্যাম্পু|shampoo/i,['hair','shampoo']],
 ['home',/home\s*(and|&)?\s*kitchen|হোম|কিচেন/i,['home','kitchen']]
];
function cleanContext(c){
 c=c&&typeof c==='object'?c:{};const n=(v,max)=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0?Math.min(max,Number(v)):null;
 return {terms:Array.isArray(c.terms)?c.terms.filter(x=>typeof x==='string').map(x=>x.slice(0,50)).slice(0,5):[],group:typeof c.group==='string'?c.group.slice(0,40):'',max:c.max==null?null:n(c.max,1e8),min:c.min==null?null:n(c.min,1e8),free:c.free===true,cod:c.cod===true,discount:c.discount===true,sort:['price_asc','price_desc','new'].includes(c.sort)?c.sort:'new',page:Math.floor(n(c.page,20)||0),ids:Array.isArray(c.ids)?c.ids.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,4):[],lowest:n(c.lowest,1e8)};
}
function parse(message,context){
 const m=digits(message).toLowerCase().trim(),old=cleanContext(context);
 const more=/আরও\s*(দেখাও|পণ্য|দাও)|aro\s*(dekhao|dekha|dew|dao)|show more|next|আরো দেখাও/.test(m);
 const follow=more||/আরও কম|আরো কম|aro kom|cheaper|সস্তা|কম দাম|kom dam|low.*price|price.*low|free delivery|ফ্রি ডেলিভারি|cod|ক্যাশ|within|under|মধ্যে|niche|নিচে|budget|বাজেট|new arrival|নতুন|discount|ছাড়|ছাড়|compare|তুলনা/.test(m);
 let c=follow?old:cleanContext({});c.page=more?old.page+1:0;
 const matched=groups.find(g=>g[1].test(m));if(matched){c.group=matched[0];c.terms=[];}
 if(/free\s*(delivery|shipping)|ফ্রি\s*(ডেলিভারি|শিপিং)|বিনা.*ডেলিভারি/.test(m))c.free=true;
 if(/\bcod\b|cash on delivery|ক্যাশ.*ডেলিভারি/.test(m))c.cod=true;
 if(/discount|offer|ছাড়|ছাড়|অফার/.test(m))c.discount=true;
 if(/new arrival|নতুন|notun|latest/.test(m))c.sort='new';
 if(/সবচেয়ে কম|সবচেয়ে কম|কম দাম|কম থেকে বেশি|kom dam|cheapest|low.*price|price.*low|সস্তা/.test(m))c.sort='price_asc';
 if(/বেশি দাম|beshi dam|high.*price|price.*high/.test(m))c.sort='price_desc';
 const range=m.match(/(\d+(?:\.\d+)?)\s*(?:টাকার?|tk|bdt)?\s*(?:থেকে|theke|to|-)\s*(\d+(?:\.\d+)?)/);
 if(range){c.min=Number(range[1]);c.max=Number(range[2]);}
 else{let budget=m.match(/(?:under|within|budget|বাজেট)\s*(?:৳|tk|bdt)?\s*(\d+(?:\.\d+)?)/)||m.match(/(\d+(?:\.\d+)?)\s*(?:টাকার?|takar?|tk|bdt|৳)?\s*(?:এর\s*)?(?:মধ্যে|নিচে|niche|moddhe|er moddhe|er niche)/)||m.match(/(?:৳|tk|bdt)\s*(\d+(?:\.\d+)?)/);if(budget){c.max=Number(budget[1]);c.min=null;}}
 if(/আরও কম|আরো কম|aro kom|cheaper/.test(m)){c.sort='price_asc';if(old.lowest>0)c.max=Math.max(0,old.lowest-.01);}
 // Recognise explicit brands/names while removing conversational/filter words.
 let query=m;for(const g of groups)query=query.replace(g[1],' ');
 query=query.replace(/free\s*(delivery|shipping)|cash on delivery|new arrivals?|ফ্রি\s*(ডেলিভারি|শিপিং)|ক্যাশ.*ডেলিভারি|\d+(?:\.\d+)?/g,' ');
 const stop=new Set(('show me find please product products good best valo bhalo khuje khuji dew dao dekhao dekha ache ase er ar r theke to tk taka bdt under within budget moddhe niche kom dam beshi price low high cheapest cheaper more next new latest arrival discount offer cod brand brands এর আর এবং আমাকে দেখাও দেখান খুঁজে দাও পণ্য ভালো ভাল দাম কত টাকা মধ্যে নিচে থেকে সবচেয়ে সবচেয়ে কম বেশি টাকার takar আছে হবে ফ্রি ডেলিভারি নতুন ছাড় ছাড় অফার ছাড়ের ছাড়ের অফারের বাজেট আরও আরো চাই চাইছি chao chai ki koto free delivery shipping skin care compare tulona তুলনা করো koro details detail description সম্পর্কে বিষয়ে বিষয়ে বলো bolo এই এটা এইটার এটার producter sob all সব দামের দামে এমন যেগুলো যেটা যেটার মধ্যে এর মধ্যে ba bole bolun বলুন দিন খুঁজুন খুজে খুঁজে bhalo valo aro emon এগুলো এগুলোর পণ্যের ও কেমন kemon besi beshi kom theke').split(/\s+/));
 const terms=query.replace(/[^\p{L}\p{M}\p{N}\s'-]/gu,' ').split(/\s+/).filter(x=>x.length>1&&!stop.has(x)).slice(0,5);
 if(!more&&terms.length)c.terms=terms;
 c=cleanContext(c);if(c.max!==null&&c.min!==null&&c.min>c.max)[c.min,c.max]=[c.max,c.min];
 return {context:c,more,compare:/compare|তুলনা|tulona/.test(m),info:/এই|এটার|এইটার|এটি|this|etar|eitar|variant|ভ্যারিয়েন্ট|delivery time|ডেলিভারি.*দিন|stock|স্টক|দাম কত|price koto|dam koto|details|description/.test(m),greeting:/^(hi|hello|hey|হাই|হ্যালো|সালাম|আসসালামু আলাইকুম)[!.\s]*$/.test(m)};
}
const PRICE='(CASE WHEN p.sale_price>0 THEN p.sale_price ELSE p.regular_price END)';
function buildQuery(c){
 const where=['p.stock_quantity>0',PRICE+'>=0'],params=[];
 const group=groups.find(x=>x[0]===c.group);
 if(group){where.push('('+group[2].map(()=>"CONCAT_WS(' ',p.title,p.category,p.sub_category,p.keywords) LIKE ?").join(' OR ')+')');params.push(...group[2].map(x=>'%'+x+'%'));}
 for(const term of c.terms){where.push("CONCAT_WS(' ',p.title,p.brand_name,p.keywords,p.category) LIKE ?");params.push('%'+term.replace(/[\\%_]/g,'\\$&')+'%');}
 if(c.min!==null){where.push(PRICE+'>=?');params.push(c.min);}if(c.max!==null){where.push(PRICE+'<=?');params.push(c.max);}
 if(c.free)where.push('p.free_shipping=1');if(c.cod)where.push('p.cod_available=1');if(c.discount)where.push('p.sale_price>0 AND p.regular_price>p.sale_price');
 const order=c.sort==='price_asc'?PRICE+' ASC,p.id DESC':c.sort==='price_desc'?PRICE+' DESC,p.id DESC':'p.id DESC';
 return {where:where.join(' AND '),params,order};
}
function productData(p){
 const price=Number(p.sale_price)>0?Number(p.sale_price):Number(p.regular_price);
 return {id:p.id,product_id:p.product_id,title:text(p.title).slice(0,250),price:Number.isFinite(price)?price:null,regular_price:Number(p.regular_price)||null,brand:text(p.brand_name),category:text(p.category),stock:Number(p.stock_quantity)||0,cod:Number(p.cod_available)===1,free:Number(p.free_shipping)===1,delivery_charge:p.delivery_charge==null?null:Number(p.delivery_charge),delivery_limit:Number(p.delivery_limit)||1,delivery_time:text(p.delivery_time),variants:text(p.products_variant).slice(0,700),description:text(p.description).slice(0,1000),image:p.primary_image||'',url:p.slug?'/user/product/'+encodeURIComponent(p.slug):'/user/product-details?id='+encodeURIComponent(p.product_id||p.id)};
}
const SELECT="SELECT p.*, (SELECT image_path FROM product_images WHERE product_id=p.id ORDER BY id LIMIT 1) AS primary_image FROM products p";
function createHandler(db){return async(req,res)=>{
 res.set('Cache-Control','no-store');
 const body=req.body||{},message=typeof body.message==='string'?body.message.trim():'';
 if(!message||message.length>600)return res.status(400).json({success:false,message:'১–৬০০ অক্ষরের মধ্যে প্রশ্ন লিখুন।'});
 try{
 const parsed=parse(message,body.context),c=parsed.context;
 if(parsed.greeting)return res.json({success:true,reply:'হ্যালো! পণ্যের নাম, budget, COD বা free delivery লিখে খুঁজুন। যেমন: ৫০০ টাকার মধ্যে skincare।',products:[],context:cleanContext({})});
 if(/ক্যান্সার|cancer|cure|নিরাময়|নিরাময়|চিকিৎসা|রোগ সার|pregnan|গর্ভ|পার্শ্বপ্রতিক্রিয়া/.test(message.toLowerCase()))return res.json({success:true,reply:'পণ্যের চিকিৎসাগত ফলাফল বা আপনার জন্য নিরাপদ কি না নিশ্চিত করতে পারি না। এখানে পণ্যের দেওয়া তথ্য ও দাম খুঁজতে পারি।',products:[],context:c});
 let products=[];
 if(parsed.compare){
  let ids=Array.isArray(body.compare_ids)?body.compare_ids.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,2):c.ids.slice(0,2);
  if(ids.length<2)return res.json({success:true,reply:'আগে পণ্য খুঁজুন, তারপর দুটি পণ্যের Compare button চাপুন।',products:[],context:c});
  const [rows]=await db.query(SELECT+' WHERE p.id IN (?,?)',[ids[0],ids[1]]);products=rows.map(productData);
  return res.json({success:true,reply:products.length===2?'দুটি পণ্যের বর্তমান তথ্য নিচে দিলাম। কোনটি ভালো তা ব্যক্তিগত প্রয়োজন ও পণ্যের তথ্যের ওপর নির্ভর করে।':'তুলনার দুটি পণ্য পাওয়া যায়নি।',products,compare:true,context:c});
 }
 const productRef=typeof body.product_ref==='string'?body.product_ref.slice(0,200):'';
 if(parsed.info&&(productRef||c.ids.length===1)){
  const [rows]=productRef?await db.query(SELECT+' WHERE p.slug=? OR p.product_id=? OR CAST(p.id AS CHAR)=? LIMIT 1',[productRef,productRef,productRef]):await db.query(SELECT+' WHERE p.id=? LIMIT 1',[c.ids[0]]);
  products=rows.map(productData);if(products.length){c.ids=products.map(x=>x.id);return res.json({success:true,reply:'এই পণ্যের database-এ দেওয়া তথ্য নিচে দেখুন। Delivery charge quantity অনুযায়ী বদলাতে পারে; checkout-এ মোট নিশ্চিত হবে।',products,details:true,context:c});}
 }
 if(/order.*(কিভাবে|কীভাবে|kivabe)|অর্ডার.*(কিভাবে|কীভাবে)|how to order/.test(message.toLowerCase()))return res.json({success:true,reply:'পণ্য খুলে variant ও quantity বেছে checkout করুন। লগইন করে delivery address দিন, তারপর উপলব্ধ payment method নির্বাচন করে order সম্পন্ন করুন।',products:[],context:c});
 if(/payment|পেমেন্ট|পেমেনট|কিভাবে টাকা|কীভাবে টাকা/.test(message.toLowerCase()))return res.json({success:true,reply:'Checkout-এ আপনার অর্ডারের জন্য যে payment method দেখাবে সেটিই বেছে নিন। COD পাওয়া যাবে কি না পণ্যের COD তথ্য দেখে নিশ্চিত করুন।',products:[],context:c});
 if(/ডেলিভারি|delivery|shipping/.test(message.toLowerCase())&&!c.free&&!c.terms.length&&!c.group&&!productRef)return res.json({success:true,reply:'Delivery charge ও সময় পণ্যভেদে আলাদা। পণ্য খুঁজে তার card-এর delivery তথ্য দেখুন; quantity ও address অনুযায়ী checkout-এ চূড়ান্ত হিসাব দেখাবে।',products:[],context:c});
 if(/return policy|রিটার্ন|refund/.test(message.toLowerCase())&&!productRef)return res.json({success:true,reply:'প্রতিটি পণ্যের return শর্ত আলাদা হতে পারে। সাইটের Return Policy এবং পণ্যের দেওয়া শর্ত দেখুন।',policy_url:'/user/return-policy',products:[],context:c});
 if(!c.group&&!c.terms.length&&c.max===null&&!c.free&&!c.cod&&!c.discount&&c.sort!=='price_asc'&&c.sort!=='price_desc'&&!/নতুন|notun|new|সব পণ্য|all product/.test(message.toLowerCase()))return res.json({success:true,reply:'কোন ধরনের পণ্য খুঁজছেন? পণ্যের নাম বা category ও budget লিখুন—যেমন “face wash ৫০০ টাকার মধ্যে”।',products:[],context:c});
 const q=buildQuery(c);const [[count]]=await db.query('SELECT COUNT(*) AS total FROM products p WHERE '+q.where,q.params);
 const [rows]=await db.query(SELECT+' WHERE '+q.where+' ORDER BY '+q.order+' LIMIT 4 OFFSET ?',[...q.params,c.page*4]);products=rows.map(productData);c.ids=products.map(x=>Number(x.id));c.lowest=products.length?Math.min(...products.map(x=>x.price).filter(x=>x!==null)):null;
 const filters=[c.group||c.terms.join(' '),c.min!==null?'৳'+c.min+' থেকে':'',c.max!==null?'৳'+c.max+' এর মধ্যে':'',c.free?'Free delivery':'',c.cod?'COD':'',c.discount?'Discount':''].filter(Boolean).join(' · ');
 return res.json({success:true,reply:products.length?'আপনার শর্তে '+count.total+'টি পণ্য পাওয়া গেছে।'+(filters?'\n'+filters:'')+'\nবর্তমান ফলাফল: '+(c.page*4+1)+'–'+(c.page*4+products.length):'এই শর্তে আর পণ্য পাওয়া যায়নি। Budget বাড়িয়ে বা শর্ত কমিয়ে আবার খুঁজুন।',products,has_more:(c.page+1)*4<Number(count.total)&&c.page<20,context:c});
 }catch(e){console.error('Shop assistant:',e.code||e.message);return res.status(500).json({success:false,message:'এখন পণ্য খোঁজা যাচ্ছে না। একটু পরে চেষ্টা করুন।'});}
};}
module.exports={createHandler,parse,buildQuery,productData,cleanContext};
