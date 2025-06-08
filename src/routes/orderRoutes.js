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
  const { pageNum = 1, pageSize = 10,storeId,memberId,orderStatus, orderSn, endDate, startDate, ...otherParams } = req.query;

  const where = {};
  if (orderSn) where.id = orderSn;
  if (orderStatus) where.order_status = orderStatus;
  if (startDate || endDate) {
    where.create_time = {};
    if (startDate) where.create_time.gte = new Date(startDate);
    if (endDate) where.create_time.lte = new Date(endDate);
  }
  // Nếu có memberId thì chỉ lấy order của member đó, không có thì lấy tất cả
  if (memberId) {
    where.member_id = memberId;
  }
  if (storeId) {
    where.store_id = storeId;
  }
  const [records, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include:{
        user:true
      }
    }),
    prisma.order.count({ where })
  ]);

  // Lấy danh sách storeId duy nhất từ records
  const storeIds = [...new Set(records.map(r => r.store_id).filter(Boolean))];
  let storeMap = {};
  if (storeIds.length > 0) {
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, store_name: true }
    });
    storeMap = stores.reduce((acc, s) => { acc[s.id] = s.store_name; return acc; }, {});
  }

  // Gán storeName vào từng order, chuyển flowPrice, goodsPrice về number, và format create_time
  const recordsWithStoreName = records.map(record => {
    // Format create_time sang dd-mm-yyyy
    let formattedCreateTime = record.create_time;
    if (formattedCreateTime) {
      const date = new Date(formattedCreateTime);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formattedCreateTime = `${day}-${month}-${year}`;
    }
    return {
      ...record,
      storeName: storeMap[record.store_id] || null,
      flowPrice: record.flow_price && typeof record.flow_price.toNumber === 'function' ? record.flow_price.toNumber() : record.flow_price,
      goodsPrice: record.goods_price && typeof record.goods_price.toNumber === 'function' ? record.goods_price.toNumber() : record.goods_price,
      create_time: formattedCreateTime,
      username: record.user ? record.user.username : null,
    };
  });

  const result = {
    records: recordsWithStoreName,
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
  // Lấy order chi tiết
  const order = await prisma.order.findUnique({
    where: { sn: orderSn },
  });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found', code: 404 });
  }

  let storeName = null;
  if (order.store_id) {
    const store = await prisma.store.findUnique({ where: { id: order.store_id }, select: { store_name: true } });
    storeName = store ? store.store_name : null;
  }

  let memberName = null;
  if (order.member_id) {
    const member = await prisma.user.findUnique({ where: { id: order.member_id }, select: { username: true } });
    memberName = member ? member.username : null;
  }

  const orderItems = await prisma.order_item.findMany({
    where: { order_sn: order.sn },
    orderBy: { id: 'asc' },
    include: { goods: { select: { goods_name: true } } }
  });

  // decimal -> number do lỗi prisma trả decimal thành object
  function toNumber(val) {
    return val && typeof val.toNumber === 'function' ? val.toNumber() : val;
  }

  // Xử lý orderItems: chuyển decimal về number và thêm goodsName
  const orderItemsResult = orderItems.map(item => ({
    ...item,
    unitPrice: toNumber(item.unit_price),
    subTotal: toNumber(item.unit_price) * toNumber(item.num),
    goodsName: item.goods ? item.goods.goods_name : null
  }));

  // Xử lý order
  const orderResult = {
    ...order,
    storeName,
    memberName,
    freightPrice: toNumber(order.freight_price),
    deleteFlag: false,
  };

    const camelCaseResult = camelcaseKeys({
        order: orderResult,
        orderItems: orderItemsResult,
    }, { deep: true });

  res.json(resultData(camelCaseResult));
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
  const { pageNum = 1, pageSize = 10, endDate, startDate, paymentMethod, sn, payStatus, ...otherParams } = req.query;

  const where = {};
 
  if (sn) where.sn = { contains: sn };
  if (paymentMethod) where.payment_method = paymentMethod;
  if (payStatus) where.pay_status = payStatus;
  if (startDate || endDate) {
    where.payment_time = {};
    if (startDate) where.payment_time.gte = new Date(startDate);
    if (endDate) where.payment_time.lte = new Date(endDate);
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
      where.order_sn = { in: snList };
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

  // Lấy dữ liệu phân trang, include order (lấy store) và order.store (lấy store_name)
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
            store: { select: { store_name: true } }
          }
        }
      }
    }),
    prisma.payment_log.count({ where })
  ]);


  // Gán storeName, paymentMethod, payStatus vào records và format create_time
  const recordsWithExtra = records.map(r => {
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
      storeName: r.order?.store?.store_name || null,
      paymentMethod: r.order?.payment_method || null,
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