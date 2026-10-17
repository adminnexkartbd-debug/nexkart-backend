const router = require('express').Router();
const path = require('path');
const db = require('../../db');
router.get(['/love-list', '/wishlist'], (req, res) => res.sendFile(path.join(__dirname, '../../public/users/wishlist.html')));
router.use('/api/love-list', (req, res, next) => {
  const id = req.user?.id || req.session?.user?.id || req.session?.userId;
  if (!id) return res.status(401).json({message:'Please log in to save your favourites.'});
  res.locals.loveUserId = id;
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/api/love-list', async (req,res) => {
  try {
    const [items] = await db.query(`SELECT p.id, p.slug, p.product_id, p.title, p.sale_price, p.regular_price,
      (SELECT image_path FROM product_images WHERE product_id=p.id ORDER BY id LIMIT 1) AS primary_image,
      w.created_at FROM user_wishlist w JOIN products p ON p.id=w.product_id
      WHERE w.user_id=? ORDER BY w.created_at DESC, p.id DESC`, [res.locals.loveUserId]);
    res.json({success:true,items});
  } catch(e) { console.error('Wishlist:',e.code);res.status(500).json({message:'Unable to load Wishlist. Please try again.'}); }
});
router.put('/api/love-list/:id', async(req,res) => {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1||typeof req.body.saved!=='boolean') return res.status(400).json({message:'Invalid product or saved state.'});
  try {
    if(req.body.saved) {
      const [products]=await db.query('SELECT id FROM products WHERE id=? LIMIT 1',[id]);
      if(!products.length) return res.status(404).json({message:'Product no longer available.'});
      await db.query('INSERT IGNORE INTO user_wishlist (user_id,product_id) VALUES (?,?)',[res.locals.loveUserId,id]);
    } else await db.query('DELETE FROM user_wishlist WHERE user_id=? AND product_id=?',[res.locals.loveUserId,id]);
    res.json({success:true,saved:req.body.saved});
  }catch(e){console.error('Wishlist save:',e.code);res.status(500).json({message:'Could not update Wishlist. Please try again.'});}
});
module.exports=router;
