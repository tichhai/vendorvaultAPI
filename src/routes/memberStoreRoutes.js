// routes/member.js
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

// GET /store/member/evaluation
router.get('/evaluation',authMiddleware, async (req, res) => {
  const { pageNum = 1, pageSize = 10, username,goodsName,grade,startTime,endTime, ...otherParams } = req.query;
  const where = {store_id: req.storeId}; 
  if (username) {
    where.user = { username: { contains: username } };
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

// PUT /store/member/evaluation/reply/:id
router.put('/evaluation/reply/:id', async (req, res) => {
  //trả về reply images là ["",""]
  const { id } = req.params;
  const { reply, replyImage } = req.body; 

  if (!id || !reply) {
    return res.status(400).json({ code: 400, message: 'No Info', data: null });
  }

  try {
    const evaluation = await prisma.user_evaluation.findUnique({
      where: { id: id }
    });
    if (!evaluation) {
      return res.status(404).json({ code: 404, message: 'No Review', data: null });
    }

    await prisma.user_evaluation.update({
      where: { id: id },
      data: {
        reply: reply,
        reply_image: Array.isArray(replyImage) ? replyImage.join(',') : (replyImage || ''),
      }
    });
    res.json(resultSuccess());
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

// GET /store/member/evaluation/get/:id
router.get('/evaluation/get/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ code: 400, message: 'No ID', data: null });
  }

  try {
    const evaluation = await prisma.user_evaluation.findUnique({
      where: { id: id }
    });

    if (!evaluation) {
      return res.status(404).json({ code: 404, message: 'No Review', data: null });
    }
    const result = camelcaseKeys(evaluation, { deep: true });
    res.json(resultData(result));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message, data: null });
  }
});

module.exports = router;
