'use strict';
const express=require('express');
const {createController}=require('../../controllers/paystationController');
module.exports=function makePaystationRouter(adapters) {
  const router=express.Router();
  const ctrl=createController(adapters);
  router.post('/paystation/start',ctrl.start);
  router.all('/paystation/callback',ctrl.callback);
  router.post('/paystation/ipn',ctrl.ipn);
  return router;
};
