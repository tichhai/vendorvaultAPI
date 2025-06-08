// routes/member.js
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

// GET /store/member/evaluation
router.get('/evaluation', async (req, res) => {
  const { pageNum = 1, pageSize = 10, memberName,goodsName,grade,startTime,endTime, ...otherParams } = req.query;
  const where = {};
  if (memberName) {
    where.user = { username: { contains: memberName } };
  }
  const [records, total] = await Promise.all([
    prisma.user_evaluation.findMany({
      where,
      skip: (parseInt(pageNum) - 1) * parseInt(pageSize),
      take: parseInt(pageSize),
      orderBy: { id: 'desc' },
      include: {
        user: true,
        goods: true
      }
    }),
    prisma.user_evaluation.count({ where })
  ]);

  // Thêm trường username, goodsName và format create_time cho từng record
  const recordsWithUsername = records.map(record => {
    let formatted = {
      ...record,
      username: record.user ? record.user.username : null,
      goodsName: record.goods ? record.goods.goods_name : null,
      avatar: record.user ? record.user.face : null,
    };
    if (formatted.create_time) {
      const date = new Date(formatted.create_time);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formatted.create_time = `${day}-${month}-${year}`;
    }
    return formatted;
  });

  const result = {
    records: recordsWithUsername,
    total,
    size: parseInt(pageSize),
    current: parseInt(pageNum),
    pages: Math.ceil(total / parseInt(pageSize))
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });

  res.json(resultData(camelCaseResult));
});

module.exports = router;
