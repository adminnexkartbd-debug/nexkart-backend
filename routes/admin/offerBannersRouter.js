'use strict';
const express=require('express');
const multer=require('multer');
const sharp=require('sharp');
const crypto=require('crypto');
const db=require('../../db');
const {v2:cloud}=require('cloudinary');
cloud.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:10},fileFilter(req,file,cb){if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype))return cb(new Error('Unsupported image format'));cb(null,true);}}).single('image');
function fields(body={}) {
 const title=String(body.title||'').trim(),alt=String(body.alt_text||'').trim(),target=String(body.target_url||'').trim();
 if(!title || title.length>150 || alt.length>200 || target.length>1000)throw new Error('Enter a title (max 150), alt text (max 200), and valid link (max 1000).');
 if(target){
  // Banner links are restricted to this shop; reject scripts, protocol-relative and external URLs.
  if(/[\s\\\x00-\x1f]/.test(target))throw new Error('Use a NexkartBD link or a path starting with /.');
  const u=new URL(target,'https://www.nexkartbd.com');
  if(u.protocol!=='https:' || !['www.nexkartbd.com','nexkartbd.com'].includes(u.hostname) || u.username || u.password || u.port)throw new Error('Link must belong to nexkartbd.com.');
  if(!target.startsWith('/') && !/^https:\/\//i.test(target))throw new Error('Use a full HTTPS shop URL or a path starting with /.');
  if(target.startsWith('//'))throw new Error('Use a path starting with one /.');
 }
 const sort=Number(body.sort_order),active=String(body.is_active);
 if(!Number.isInteger(sort)||sort<0||sort>999999||!['0','1'].includes(active))throw new Error('Invalid display order or active status.');
 return {title,alt_text:alt,target_url:target,sort_order:sort,is_active:Number(active)};
}
const idValue=x=>/^\d+$/.test(String(x))&&Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
router.use((req,res,next)=>{
 res.set('Cache-Control','no-store');
 if(req.session?.pinVerified!==true)return res.status(403).json({success:false,message:'Verify the Control Employee admin PIN first.'});
 if(!req.session.bannerCsrf)req.session.bannerCsrf=crypto.randomBytes(32).toString('hex');
 if(!['GET','HEAD'].includes(req.method)){
  const token=req.get('X-Banner-CSRF')||'';
  if(!/^[a-f0-9]{64}$/.test(token) || !crypto.timingSafeEqual(Buffer.from(token),Buffer.from(req.session.bannerCsrf)))return res.status(403).json({success:false,message:'Session expired. Reopen Banner Manager.'});
 }
 next();
});
function failure(res,e){console.error('Offer banners:',e.code||e.message);return res.status(e.code==='ER_NO_SUCH_TABLE'?503:500).json({success:false,message:e.code==='ER_NO_SUCH_TABLE'?'Run the offer_banners SQL in defaultdb first.':'Banner operation failed. Please try again.'});}
async function removeImage(publicId){if(!publicId||!publicId.startsWith('nexkart_offer_banners/'))return;try{await cloud.uploader.destroy(publicId,{resource_type:'image',invalidate:true});}catch(e){console.error('Banner image cleanup failed:',publicId);}}
async function imageUpload(file){
 if(!file)throw new Error('Choose a JPG, PNG or WebP image (maximum 5 MB).');
 const image=sharp(file.buffer,{limitInputPixels:25000000});const meta=await image.metadata();
 if(!['jpeg','png','webp'].includes(meta.format)||meta.width<300||meta.height<100)throw new Error('Use a JPG, PNG or WebP image at least 300 × 100 pixels.');
 const buffer=await image.rotate().resize({width:2000,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
 return new Promise((resolve,reject)=>{const stream=cloud.uploader.upload_stream({folder:'nexkart_offer_banners',resource_type:'image',format:'webp'},(error,result)=>error?reject(error):resolve(result));stream.end(buffer);});
}
router.get('/',async(req,res)=>{
 try{
  const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1)),limit=12;
  const q=String(req.query.q||'').trim().slice(0,150),status=String(req.query.status||'all');
  const condition=status==='active'?' AND is_active=1':status==='inactive'?' AND is_active=0':'';
  const where=' WHERE title LIKE ?'+condition;
  const [[stats]]=await db.query('SELECT COUNT(*) AS total,COALESCE(SUM(is_active=1),0) AS active,COALESCE(SUM(is_active=0),0) AS inactive FROM offer_banners');
  const [[count]]=await db.query('SELECT COUNT(*) AS matched FROM offer_banners'+where,['%'+q+'%']);
  const [rows]=await db.query('SELECT id,title,alt_text,image_url,target_url,sort_order,is_active,version,created_at,updated_at FROM offer_banners'+where+' ORDER BY sort_order ASC,id DESC LIMIT ? OFFSET ?',['%'+q+'%',limit,(page-1)*limit]);
  res.json({success:true,csrf:req.session.bannerCsrf,stats,rows,page,pages:Math.max(1,Math.ceil(count.matched/limit)),matched:count.matched});
 }catch(e){failure(res,e);}
});
router.post('/',(req,res,next)=>upload(req,res,e=>e?res.status(400).json({success:false,message:e.code==='LIMIT_FILE_SIZE'?'Image must be 5 MB or smaller.':'Invalid upload.'}):next()),async(req,res)=>{
 let image;
 try{
  let data;try{data=fields(req.body);if(!req.file)throw Error('Choose a JPG, PNG or WebP image (max 5 MB).');}catch(e){return res.status(400).json({success:false,message:e.message});}
  try{image=await imageUpload(req.file);}catch(e){return res.status(400).json({success:false,message:'Image upload failed. Check image format, size and Cloudinary configuration.'});}
  const [result]=await db.query('INSERT INTO offer_banners (title,alt_text,image_url,image_public_id,target_url,sort_order,is_active) VALUES (?,?,?,?,?,?,?)',[data.title,data.alt_text,image.secure_url,image.public_id,data.target_url,data.sort_order,data.is_active]);
  res.status(201).json({success:true,id:result.insertId,message:'Banner posted.'});
 }catch(e){if(image)await removeImage(image.public_id);failure(res,e);}
});
router.put('/:id',(req,res,next)=>upload(req,res,e=>e?res.status(400).json({success:false,message:e.code==='LIMIT_FILE_SIZE'?'Image must be 5 MB or smaller.':'Invalid upload.'}):next()),async(req,res)=>{
 let image,committed=false;
 try{
  const id=idValue(req.params.id),version=idValue(req.body.version);if(!id||!version)return res.status(400).json({success:false,message:'Invalid banner or version.'});
  let data;try{data=fields(req.body);}catch(e){return res.status(400).json({success:false,message:e.message});}
  const [[old]]=await db.query('SELECT image_url,image_public_id,version FROM offer_banners WHERE id=?',[id]);
  if(!old)return res.status(404).json({success:false,message:'Banner not found.'});
  if(Number(old.version)!==version)return res.status(409).json({success:false,message:'Banner changed. Refresh the list and edit again.'});
  if(req.file){try{image=await imageUpload(req.file);}catch(e){return res.status(400).json({success:false,message:'Image upload failed. Use a valid JPG, PNG or WebP.'});}}
  const [result]=await db.query('UPDATE offer_banners SET title=?,alt_text=?,target_url=?,sort_order=?,is_active=?,image_url=?,image_public_id=?,version=version+1 WHERE id=? AND version=?',[data.title,data.alt_text,data.target_url,data.sort_order,data.is_active,image?.secure_url||old.image_url,image?.public_id||old.image_public_id,id,version]);
  if(!result.affectedRows){if(image)await removeImage(image.public_id);return res.status(409).json({success:false,message:'Banner changed. Refresh and try again.'});}
  committed=true;if(image)await removeImage(old.image_public_id);
  res.json({success:true,message:'Banner updated.'});
 }catch(e){if(image&&!committed)await removeImage(image.public_id);failure(res,e);}
});
router.patch('/:id/status',async(req,res)=>{
 try{const id=idValue(req.params.id),v=idValue(req.body?.version),active=String(req.body?.is_active);if(!id||!v||!['0','1'].includes(active))return res.status(400).json({success:false,message:'Invalid status.'});
 const [result]=await db.query('UPDATE offer_banners SET is_active=?,version=version+1 WHERE id=? AND version=?',[Number(active),id,v]);
 if(!result.affectedRows)return res.status(409).json({success:false,message:'Banner changed or deleted. Refresh and try again.'});
 res.json({success:true,message:'Banner status updated.'});}catch(e){failure(res,e);}
});
router.delete('/:id',async(req,res)=>{
 try{const id=idValue(req.params.id),v=idValue(req.body?.version);if(!id||!v)return res.status(400).json({success:false,message:'Invalid banner or version.'});
 const [[row]]=await db.query('SELECT image_public_id FROM offer_banners WHERE id=?',[id]);if(!row)return res.status(404).json({success:false,message:'Banner not found.'});
 const [result]=await db.query('DELETE FROM offer_banners WHERE id=? AND version=?',[id,v]);if(!result.affectedRows)return res.status(409).json({success:false,message:'Banner changed. Refresh and try again.'});
 await removeImage(row.image_public_id);res.json({success:true,message:'Banner deleted.'});}catch(e){failure(res,e);}
});
module.exports=router;
module.exports.validateFields=fields;
