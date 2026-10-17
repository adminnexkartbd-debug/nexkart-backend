'use strict';
const crypto = require('crypto');
const hashOtp = value => crypto.createHash('sha256').update(value).digest('hex');
function normalizePhone(value) {
  let phone=String(value || '').trim().replace(/[\s()-]/g,'').replace(/[০-৯]/g,x=>String('০১২৩৪৫৬৭৮৯'.indexOf(x)));
  phone=phone.replace(/^(\+880|00880|880)/,'0');
  return /^01[3-9]\d{8}$/.test(phone) ? phone : null;
}
const saveSession = req => new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
function createManualSignup({db,bcrypt,sendMail,now=Date.now}) {
  const busy = new Set();
  function locked(handler) {
    return async (req,res)=>{
      const key=req.sessionID;
      if(busy.has(key))return res.status(429).send('Please wait for the previous request to finish.');
      busy.add(key);
      try { return await handler(req,res); }
      catch(err) {console.error('Manual signup:',err.code || err.message);return res.status(500).send('Signup could not be completed. Please try again.');}
      finally {busy.delete(key);}
    };
  }
  async function exists(email) {
    const [admins]=await db.query('SELECT id FROM admins WHERE email = ? LIMIT 1',[email]);
    if(admins.length)return 'This email belongs to an Admin! Cannot register as User.';
    const [users]=await db.query('SELECT id FROM users WHERE email = ? LIMIT 1',[email]);
    return users.length ? 'Email already registered! Please login.' : null;
  }
  async function issue(req,res,pending) {
    const code=String(crypto.randomInt(100000,1000000));
    req.session.signupLastSent=now();
    await saveSession(req);
    const sent=await sendMail(pending.email,'NexKartBD - Verification OTP',
      '<div style="font-family:Arial,sans-serif"><h2>NexKartBD email verification</h2><p>Your verification code:</p><p style="font-size:28px;font-weight:bold;letter-spacing:5px">'+code+'</p><p>Valid for 5 minutes. Do not share this code.</p></div>');
    if(!sent)return res.status(502).send('OTP email could not be sent. Please try again after 60 seconds.');
    req.session.pendingSignup={...pending,otpHash:hashOtp(code),expiresAt:now()+300000,attempts:pending.attempts || 0};
    await saveSession(req);
    return res.send('OTP_SENT');
  }
  const signup=locked(async(req,res)=>{
    const body=req.body || {};
    const name=typeof body.name==='string'?body.name.trim():'';
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    const phone=normalizePhone(body.phone_number);
    const password=body.password;
    if(!name || name.length>100)return res.status(400).send('Enter your full name (maximum 100 characters).');
    if(email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return res.status(400).send('Enter a valid email address.');
    if(!phone)return res.status(400).send('Enter a valid Bangladesh mobile number, e.g. 01712345678.');
    if(typeof password!=='string' || password.length<6 || Buffer.byteLength(password)>72)return res.status(400).send('Password must contain at least 6 characters and at most 72 UTF-8 bytes.');
    if(password!==body.confirm_password)return res.status(400).send('Passwords do not match!');
    if(req.session.signupLastSent && now()-req.session.signupLastSent<60000)return res.status(429).send('Please wait 60 seconds before requesting another OTP.');
    const problem=await exists(email);if(problem)return res.status(400).send(problem);
    const hashed=await bcrypt.hash(password,10);
    return issue(req,res,{name,email,phone_number:phone,password:hashed,attempts:0});
  });
  const resend=locked(async(req,res)=>{
    const p=req.session.pendingSignup;
    if(!p)return res.status(400).send('Please fill in the signup form again.');
    if(p.attempts>=5)return res.status(429).send('Too many incorrect codes. Please start signup again.');
    if(now()-req.session.signupLastSent<60000)return res.status(429).send('Please wait 60 seconds before requesting another OTP.');
    const problem=await exists(p.email);if(problem)return res.status(400).send(problem);
    return issue(req,res,p);
  });
  const verify=locked(async(req,res)=>{
    const p=req.session.pendingSignup;
    if(!p || now()>p.expiresAt){delete req.session.pendingSignup;await saveSession(req);return res.status(400).send('OTP expired. Please sign up again.');}
    if(p.attempts>=5)return res.status(429).send('Too many incorrect codes. Please start signup again.');
    const code=String(req.body?.entered_otp || '').trim();
    if(!/^\d{6}$/.test(code) || hashOtp(code)!==p.otpHash){p.attempts++;await saveSession(req);return res.status(400).send('Invalid OTP! Please check your email.');}
    const problem=await exists(p.email);if(problem)return res.status(400).send(problem);
    try {
      await db.query('INSERT INTO users (name,email,phone_number,password,is_verified,created_at) VALUES (?,?,?,?,1,NOW())',[p.name,p.email,p.phone_number,p.password]);
    } catch(err) {
      if(err.code==='ER_DUP_ENTRY')return res.status(409).send('Account details already registered. Please login or use different details.');
      throw err;
    }
    delete req.session.pendingSignup;
    await saveSession(req);
    return res.send('SUCCESS');
  });
  return {signup,verify,resend};
}
module.exports={createManualSignup,normalizePhone};
