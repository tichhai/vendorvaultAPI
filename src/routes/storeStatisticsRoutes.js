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

// GET /store/statistics/index
router.get('/index',authMiddleware, async (req, res) => {
  try {
    const store_id = req.storeId;
    const today = new Date();
    today.setHours(0,0,0,0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    // Lấy stock_warning của store
    const store = await prisma.store.findUnique({ where: { id: store_id }, select: { stock_warning: true } });
    const stockWarning = store && store.stock_warning ? store.stock_warning : 100;

    const [
      orderNum,
      goodsNum,
      unPaidOrder,
      memberEvaluation,
      alertQuantityNum,
      waitAuth,
      todayOrderCountAndSum
    ] = await Promise.all([
      // Tổng số sub_order của store này
      prisma.sub_order.count({ where: { store_id } }),
      // Tổng số goods của store này
      prisma.goods.count({ where: { store_id } }),
      // Số sub_order chưa thanh toán
      prisma.sub_order.count({ where: { store_id, status: 'UNPAID' } }),
      // member evaluation chưa reply
      prisma.user_evaluation.count({ where: { store_id, OR: [ { reply: null }, { reply: '' } ] } }),
      // goods có quantity < stock_warning
      prisma.goods.count({ where: { store_id, quantity: { lt: stockWarning } } }),
      // goods có auth_flag là TOBEAUDITED
      prisma.goods.count({ where: { store_id, auth_flag: 'TOBEAUDITED' } }),
      // sub_order today: count và sum
      prisma.sub_order.aggregate({
        where: {
          store_id,
          create_time: { gte: today, lt: tomorrow }
        },
        _count: { id: true },
        _sum: { sub_total: true }
      })
    ]);

    const statistics = {
      orderNum, // tổng số sub_order (đơn của store)
      goodsNum,
      unPaidOrder, // số sub_order chưa thanh toán
      memberEvaluation,
      alertQuantityNum,
      waitAuth,
      todayOrderNum: todayOrderCountAndSum._count.id || 0,
      todayOrderPrice: todayOrderCountAndSum._sum.sub_total && typeof todayOrderCountAndSum._sum.sub_total.toNumber === 'function' ? todayOrderCountAndSum._sum.sub_total.toNumber() : todayOrderCountAndSum._sum.sub_total || 0
    };

    res.json(resultData(statistics));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

module.exports = router;
