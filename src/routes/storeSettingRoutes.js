const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
function resultData(data) {
  return {
    success: true,
    message: "success",
    code: 200,
    result: data,
  };
}

function resultSuccess() {
  return {
    success: true,
    code: 200, 
    message: 'success',
    data: null
  };
}

function resultErrorMsg(msg, code = 500) {
  return {
    success: false,
    message: msg,
    code,
  };
}

// Middleware giải mã JWT và lấy user info
async function authMiddleware(req, res, next) {
  const token = req.headers.accesstoken;
  if (!token) {
    return res.status(401).json(resultErrorMsg("No accessToken", 401));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.tokenUser = decoded;
    req.storeId = decoded.storeId; 
    next();
  } catch (err) {
    return res
      .status(401)
      .json(resultErrorMsg("The token is invalid or expired.", 401));
  }
}

// GET /store/settings/storeSettings
router.get('/storeSettings',authMiddleware, async (req, res) => {
  try {
    if (!req.tokenUser) {
      return res.status(400).json({ code: 400, message: 'No token', data: null });
    }
    let storeDetail = await prisma.store.findFirst({
      where: { id: BigInt(req.storeId) },
    });
    const user = await prisma.user.findUnique({
      where: { username: req.tokenUser.username },
      select: {
        username: true,
      }
    });
    storeDetail = {
      ...storeDetail,
      username: user.username || '',
    }
    const camelCaseResult = camelcaseKeys(storeDetail, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching store settings:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /store/settings/storeSettings
router.put('/storeSettings',authMiddleware, async (req, res) => {
  const {storeName,storeLogo,storeAddressDetail,storeDesc} = req.body;
  try {
    const result = await prisma.store.update({
      where: { id: req.storeId },
      data: { 
        store_name: storeName,
        store_logo: storeLogo,
        store_address_detail: storeAddressDetail,
        store_desc: storeDesc
      },
    });
    
    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /store/settings/storeSettings/updateStockWarning
router.put('/storeSettings/updateStockWarning',authMiddleware, async (req, res) => {
  const { stockWarning } = req.body;

  if (!stockWarning || isNaN(Number(stockWarning))) {
    return res.status(400).json({ code: 400, message: 'No Stock Warning', data: null });
  }

  try {
    const result = await prisma.store.update({
      where: { id: req.storeId },
      data: { stock_warning: Number(stockWarning) }
    });

    res.json(resultData());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// POST /store/settings/update-payment-due-date
router.post('/update-payment-due-date', async (req, res) => {
  const { userId:storeId, months } = req.body;
  if (!storeId) {
    return res.status(400).json({ code: 400, message: 'Missing storeId', data: null });
  }
  try {
    // Lấy payment_due_date cũ
    const store = await prisma.store.findUnique({ where: { id: Number(storeId) } });
    let baseDate = store && store.payment_due_date ? new Date(store.payment_due_date) : new Date();
    let addMonths = parseInt(months);
    if (isNaN(addMonths) || addMonths < 1) addMonths = 1;
    baseDate.setMonth(baseDate.getMonth() + addMonths);
    // Update payment_due_date cho store
    await prisma.store.update({
      where: { id: Number(storeId) },
      data: { payment_due_date: baseDate }
    });
    const user = await prisma.user.findFirst({
      where: { store_id: BigInt(storeId) },
    })
    await prisma.payment_log.create({
      data: {
        store_id: BigInt(storeId),
        create_time: new Date(),
        payment_time:new Date(),
        member_id: user ? BigInt(user.id) : null,
        pay_status: 'PAID',
        type: `PAYMENT`,
      }
    });
    res.json(resultSuccess());
  } catch (e) {
    console.error('Error updating payment due date:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

module.exports = router;
