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

// GET /manager/store/store
router.get('/store', async (req, res) => {
  console.log('Fetching store list with query:', req.query);
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const { endDate, startDate, storeDisable, storeName } = req.query;
  const where = {};

  if (storeName) where.store_name = { contains: storeName };
  if (storeDisable) where.store_disable = storeDisable;
  
  if (startDate || endDate) {
    where.create_time = {};
    if (startDate) where.create_time.gte = new Date(startDate);
    if (endDate) where.create_time.lte = new Date(endDate);
  }

  try {
    const [records, total] = await Promise.all([
      prisma.store.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.store.count({ where })
    ]);
    // Format create_time sang dd-mm-yyyy cho từng record
    const recordsWithFormattedDates = records.map(record => {
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
        create_time: formattedCreateTime
      };
    });
    const result = {
      records: recordsWithFormattedDates,
      total,
      size: pageSize,
      current: pageNo,
      pages: Math.ceil(total / pageSize)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    console.error('Error fetching stores:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /manager/store/store/disable/:id
router.put('/store/disable/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.store.update({
      where: { id },
      data: { store_disable: 'CLOSE' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /manager/store/store/enable/:id
router.put('/store/enable/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.store.update({
      where: { id },
      data: { store_disable: 'OPEN' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /manager/store/store/audit/:id/:passed
router.put('/store/audit/:id/:passed', async (req, res) => {
  const { id, passed } = req.params;
  // passed: 0 = approve, 1 = reject
  let status = '';
  if (passed === '0' || passed === 0) {
    status = 'OPEN';
  } else if (passed === '1' || passed === 1) {
    status = 'REFUSED';
  } else {
    return res.json({ code: 400, message: 'Invalid passed value', data: null });
  }

  try {
    await prisma.store.update({
      where: { id },
      data: { store_disable: status }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/store/store/get/detail/:storeId
router.get('/store/get/detail/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let store = await prisma.store.findUnique({
      where: { id: id },
      include: { user: true } 
    });
    store = {
        ...store,
        storeLogo: store.store_logo ? store.store_logo : null,
    }
    const result = camelcaseKeys(store, { deep: true });
    res.json(resultData(result));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

module.exports = router;