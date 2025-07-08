// routes/order.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
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

// GET /manager/order/order
router.get('/order', async (req, res) => {
  const { pageNum = 1, pageSize = 10, storeId, memberId, orderStatus, orderSn, endDate, startDate, ...otherParams } = req.query;

  // Build where clause for main order
  const where = {};
  if (orderSn) where.sn = orderSn;
  if (orderStatus) where.order_status = orderStatus;
  if (startDate || endDate) {
    where.create_time = {};
    if (startDate) where.create_time.gte = new Date(startDate);
    if (endDate) where.create_time.lte = new Date(endDate);
  }
  if (memberId) {
    where.member_id = Number(memberId);
  }

  // If storeId is provided, filter orders that have at least one sub_order with that storeId
  let subOrderWhere = {};
  if (storeId) {
    subOrderWhere.store_id = Number(storeId);
  }

  // Query paginated orders with nested sub_orders (and store if needed)
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        user: true,
        sub_order: {
          where: Object.keys(subOrderWhere).length > 0 ? subOrderWhere : undefined,
          include: {
            store: { select: { id: true, store_name: true } },
            order_item: true
          }
        }
      }
    }),
    prisma.order.count({
      where: {
        ...where,
        ...(storeId
          ? {
              sub_order: {
                some: { store_id: Number(storeId) }
              }
            }
          : {})
      }
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

  // Flatten and format the result
  const records = orders.map(order => {
    // If storeId is provided, only include sub_orders for that store
    const subOrders = order.sub_order || [];
    // For each sub_order, include storeName and format order_item
    const formattedSubOrders = subOrders.map(sub => ({
      ...sub,
      storeName: sub.store ? sub.store.store_name : null,
      subTotal: toNumber(sub.sub_total),
      create_time: formatDate(sub.create_time),
      order_item: (sub.order_item || []).map(item => ({
        ...item,
        unitPrice: toNumber(item.unit_price),
        subTotal: toNumber(item.sub_total),
      }))
    }));

    return {
      ...order,
      flowPrice: toNumber(order.flow_price),
      goodsPrice: toNumber(order.goods_price),
      create_time: formatDate(order.create_time),
      username: order.user ? order.user.username : null,
      sub_order: formattedSubOrders
    };
  });

  const result = {
    records,
    total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil(total / parseInt(pageSize))
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
});

// GET /manager/order/order/:orderSn
router.get('/order/:orderSn', async (req, res) => {
  const { orderSn } = req.params;
  try {
    // Lấy order chi tiết cùng các sub_order, order_item, goods, goods_gallery, user_evaluation
    const order = await prisma.order.findUnique({
      where: { sn: orderSn },
      include: {
        user: { select: { username: true } },
        sub_order: {
          include: {
            store: { select: { id: true, store_name: true } },
            order_item: {
              include: {
                goods: {
                  include: { goods_gallery: true,store: true}
                },
                goods_sku: true
              }
            }
          }
        }
      }
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found', code: 404 });
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

    // Format sub_orders
    const subOrders = (order.sub_order || []).map(sub => ({
      ...sub,
      store: sub.store ? { id: sub.store.id, storeName: sub.store.store_name } : null,
      subTotal: toNumber(sub.sub_total),
      create_time: formatDate(sub.create_time),
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

    const orderResult = {
      ...order,
      flowPrice: toNumber(order.flow_price),
      goodsPrice: toNumber(order.goods_price),
      create_time: formatDate(order.create_time),
      username: order.user ? order.user.username : null,
      subOrder: subOrders
    };

    const camelCaseResult = camelcaseKeys({
      order: orderResult
    }, { deep: true });

    res.json(resultData(camelCaseResult));
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, message: 'Internal server error', code: 500 });
  }
});

// POST /manager/order/order/:orderSn/pay
router.post('/order/:orderSn/pay', async (req, res) => {
  const { orderSn } = req.params;

  await prisma.order.update({
    where: { sn:orderSn },
    data: { order_status: 'PAID' ,pay_status: 'PAID' } 
  });

  res.json(resultSuccess());
});


// POST /manager/order/order/:orderSn/cancel?reason=
router.post('/order/:orderSn/cancel', async (req, res) => {
  const { orderSn } = req.params;
  const { reason } = req.body;

  if (!orderSn || !reason) {
    return res.status(400).json({ code: 400, message: 'Thiếu orderSn hoặc reason', data: null });
  }

  const order = await prisma.order.update({
    where: { sn:orderSn },
    data: {
      order_status: 'CANCELLED', 
      cancel_reason: reason  
    }
  });

  res.json(resultData());
});

// GET /manager/order/paymentLog
router.get('/paymentLog', async (req, res) => {
  const { pageNum = 1, pageSize = 10, endDate, startDate, sn, payStatus, storeId, ...otherParams } = req.query;

  // Build where clause for payment_log
  const where = { type: 'ORDER' };
  if (sn) where.sn = { contains: sn };
  if (payStatus) where.pay_status = payStatus;
  if (startDate || endDate) {
    where.payment_time = {};
    if (startDate) where.payment_time.gte = new Date(startDate);
    if (endDate) where.payment_time.lte = new Date(endDate);
  }

  // Nếu truyền storeId, chỉ lấy payment_log của sub_order thuộc store đó
  let subOrderSnList = undefined;
  if (storeId) {
    const subOrders = await prisma.sub_order.findMany({
      where: { store_id: Number(storeId) },
      select: { order_sn: true }
    });
    subOrderSnList = [...new Set(subOrders.map(s => s.order_sn))];
    if (subOrderSnList.length > 0) {
      where.sn = { in: subOrderSnList };
    } else {
      // Không có đơn nào cho store này
      return res.json(resultData(camelcaseKeys({
        records: [],
        total: 0,
        size: parseInt(pageSize),
        current: parseInt(pageNum),
        pages: 0
      }, { deep: true })));
    }
  }

  // Truy vấn thêm payStatus của order liên kết nếu chưa có trong payment_log
  if (!payStatus && otherParams.orderPayStatus) {
    // Nếu truyền orderPayStatus, lọc theo order.pay_status
    const orderIds = await prisma.order.findMany({
      where: { pay_status: otherParams.orderPayStatus },
      select: { sn: true }
    });
    const snList = orderIds.map(o => o.sn);
    if (snList.length > 0) {
      where.sn = { in: snList };
    } else {
      return res.json(resultData(camelcaseKeys({
        records: [],
        total: 0,
        size: parseInt(pageSize),
        current: parseInt(pageNum),
        pages: 0
      }, { deep: true })));
    }
  }

  // Lấy dữ liệu phân trang, include order (lấy sub_order và store)
  const [records, total] = await Promise.all([
    prisma.payment_log.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        order: {
          select: {
            payment_method: true,
            pay_status: true,
            sub_order: {
              include: {
                store: { select: { store_name: true } }
              }
            }
          }
        }
      }
    }),
    prisma.payment_log.count({ where })
  ]);

  // Gán storeName, paymentMethod, payStatus vào records và format create_time
  const recordsWithExtra = records.map(r => {
    // Lấy storeName từ sub_order đầu tiên (nếu có)
    let storeName = null;
    if (r.order && r.order.sub_order && r.order.sub_order.length > 0) {
      const subOrder = r.order.sub_order.find(s => s.store && s.store.store_name);
      if (subOrder) storeName = subOrder.store.store_name;
    }
    // Format create_time sang dd-mm-yyyy
    let formattedPaymentTime = r.payment_time;
    if (formattedPaymentTime) {
      const date = new Date(formattedPaymentTime);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formattedPaymentTime = `${day}-${month}-${year}`;
    }
    return {
      ...r,
      storeName,
      payStatus: r.order?.pay_status || null,
      payment_time: formattedPaymentTime
    };
  });

  const result = {
    records: recordsWithExtra,
    total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil(total / parseInt(pageSize))
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
});

module.exports = router;