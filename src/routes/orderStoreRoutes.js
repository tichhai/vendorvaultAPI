const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function resultErrorMsg(msg, code = 500) {
  return {
    success: false,
    message: msg,
    code,
  };
}

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

// GET /store/order/order
router.get('/order',authMiddleware, async (req, res) => {
  const { pageNum = 1, pageSize = 10, username, orderStatus, orderSn, endDate, startDate, ...otherParams } = req.query;
  // Build where clause for sub_order
  const subOrderWhere = { store_id: req.storeId };
  if (orderSn) subOrderWhere.order_sn = orderSn;
  if (orderStatus) subOrderWhere.status = orderStatus;
  if (startDate || endDate) {
    subOrderWhere.create_time = {};
    if (startDate) subOrderWhere.create_time.gte = new Date(startDate);
    if (endDate) subOrderWhere.create_time.lte = new Date(endDate);
  }

  // If username is provided, filter sub_orders by order's user.username
  let userFilter = undefined;
  if (username) {
    userFilter = username;
  }
  try{
  // Query sub_orders with pagination
  const [subOrders, total] = await Promise.all([
    prisma.sub_order.findMany({
      where: subOrderWhere,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        store: { select: { id: true, store_name: true } },
        order: {
          select: {
            sn: true,
            flow_price: true,
            goods_price: true,
            create_time: true,
            user: { select: { username: true } }
          }
        },
        order_item: {
          include: {
            goods: { include: { goods_gallery: true } },
            goods_sku: true
          }
        }
      }
    }),
    prisma.sub_order.count({
      where: subOrderWhere
    })
  ]);

  // Helper to convert Decimal to number
  function toNumber(val) {
    return val && typeof val.toNumber === 'function' ? val.toNumber() : val;
  }

  // Format create_time to dd-mm-yyyy
  function formatDate(dt) {
    if (!dt) return null;
    const date = new Date(dt);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // Filter by username if provided
  let filteredSubOrders = subOrders;
  if (userFilter) {
    filteredSubOrders = subOrders.filter(sub => sub.order && sub.order.user && sub.order.user.username === userFilter);
  }

  // Format result
  const records = filteredSubOrders.map(sub => ({
    ...sub,
    orderStatus: sub.status,
    storeName: sub.store ? sub.store.store_name : null,
    subTotal: toNumber(sub.sub_total),
    create_time: formatDate(sub.create_time),
    orderSn: sub.order_sn,
    flowPrice: sub.order && toNumber(sub.sub_total),
    goodsPrice: sub.order && toNumber(sub.order.goods_price),
    orderCreateTime: sub.order ? formatDate(sub.order.create_time) : null,
    username: sub.order && sub.order.user ? sub.order.user.username : null,
    orderItem: (sub.order_item || []).map(item => ({
      ...item,
      unitPrice: toNumber(item.unit_price),
      subTotal: toNumber(item.sub_total),
      goods: item.goods ? {
        ...item.goods,
        goodsGallery: item.goods.goods_gallery || []
      } : null,
      goodsSku: item.goods_sku || null
    }))
  }));

  const result = {
    records,
    total: userFilter ? records.length : total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil((userFilter ? records.length : total) / parseInt(pageSize))
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
  }catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /store/order/order/:subOrderId
router.get('/order/:subOrderId', async (req, res) => {
  const { subOrderId } = req.params;
  if (!subOrderId) {
    return res.status(400).json({ code: 400, message: 'No SubOrder Id', data: null });
  }
  try {
    // Lấy chi tiết sub_order, bao gồm order gốc, order_item, goods, goods_gallery, goods_sku
    const subOrder = await prisma.sub_order.findUnique({
      where: { id: Number(subOrderId) },
      include: {
        store: { select: { id: true, store_name: true } },
        order: {
          select: {
            sn: true,
            flow_price: true,
            goods_price: true,
            remark: true,
            create_time: true,
            payment_method: true,
            user: { select: { username: true } }
          }
        },
        order_item: {
          include: {
            goods: { include: { goods_gallery: true } },
            goods_sku: true
          }
        }
      }
    });
    if (!subOrder) {
      return res.status(404).json({ code: 404, message: 'No sub_order with id provided', data: null });
    }

    // Helper to convert Decimal to number
    function toNumber(val) {
      return val && typeof val.toNumber === 'function' ? val.toNumber() : val;
    }

    // Format create_time to dd-mm-yyyy
    function formatDate(dt) {
      if (!dt) return null;
      const date = new Date(dt);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }

    // Format order_item
    const orderItems = (subOrder.order_item || []).map(item => ({
      ...item,
      unitPrice: toNumber(item.unit_price),
      subTotal: toNumber(item.sub_total),
      goods: item.goods ? {
        ...item.goods,
        goodsGallery: item.goods.goods_gallery || []
      } : null,
      goodsSku: item.goods_sku || null
    }));

    const resultDataObj = {
      ...subOrder,
      storeName: subOrder.store ? subOrder.store.store_name : null,
      subTotal: toNumber(subOrder.sub_total),
      create_time: formatDate(subOrder.create_time),
      orderSn: subOrder.order_sn,
      flowPrice: subOrder.order && toNumber(subOrder.order.flow_price),
      goodsPrice: subOrder.order && toNumber(subOrder.order.goods_price),
      orderCreateTime: subOrder.order ? formatDate(subOrder.order.create_time) : null,
      username: subOrder.order && subOrder.order.user ? subOrder.order.user.username : null,
      orderItem: orderItems
    };

    let result = camelcaseKeys(resultDataObj, { deep: true });
    res.json(resultData(result));
  } catch (error) {
    console.error('Error fetching sub_order details:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /store/order/order/:subOrderId/sellerRemark
router.put('/order/:subOrderId/sellerRemark', async (req, res) => {
  const { subOrderId } = req.params;
  const { sellerRemark } = req.body;
  if (!subOrderId || !sellerRemark) {
    return res.status(400).json({ code: 400, message: 'No Info', data: null });
  }

  try {
    await prisma.sub_order.update({
      where: { id: subOrderId },
      data: { seller_remark: sellerRemark }
    });

    res.json(resultSuccess());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// PUT /store/order/order/updateOrderStatus
router.put('/order/updateOrderStatus', async (req, res) => {
  const { sn, orderStatus,subOrderId } = req.body;
  if (!sn || !orderStatus) {
    return res.status(400).json({ code: 400, message: 'No Info', data: null });
  }
  try {
    await prisma.sub_order.update({
      where: { id: subOrderId },
      data: { status: orderStatus }
    });
    res.json(resultSuccess());
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});



module.exports = router;
