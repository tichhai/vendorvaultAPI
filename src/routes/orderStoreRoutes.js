const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const camelcaseKeys = require('camelcase-keys').default;
const snakecaseKeys = require('snakecase-keys');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

//sửa
// GET /store/order/order
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

module.exports = router;
