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

// GET /store/goods/goods/list
router.get('/goods/list', async (req, res) => {
  const {goodsName,marketEnable,salesModel,id} = req.query;
  const token = req.header('accessToken');
  const pageNo = parseInt(req.query.pageNumber) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  let storeId;
//   try {
//     if (!token) throw new Error('No accessToken');
//     const decoded = jwt.verify(token, JWT_SECRET);
//     storeId = decoded.storeId;
//     if (!storeId) throw new Error('No storeId in token');
//   } catch (err) {
//     return res.json({ code: 401, message: 'Store not authenticated', data: null });
//   }

//   const where = { store_id: storeId };
const where = {};
  if (goodsName) where.goods_name = { contains: goodsName };
  if (marketEnable) where.market_enable = marketEnable;
  if (salesModel) where.sales_model = salesModel;
  if (id) where.id = Number(id);

  try {
    const [records, total] = await Promise.all([
      prisma.goods.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' }
      }),
      prisma.goods.count({ where })
    ]);
    const result = {
      records,
      total,
      size: pageSize,
      current: pageNo,
      pages: Math.ceil(total / pageSize)
    };
    const camelCaseResult = camelcaseKeys(result, { deep: true });
    res.json(resultData(camelCaseResult));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/up?goodsId=
router.put('/goods/up', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;
  try {
    await prisma.goods.update({
      where: { id: goodsId  },
      data: { market_enable: 'UPPER' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/under?goodsId=
router.put('/goods/under', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;
  try {
    await prisma.goods.update({
      where: { id: goodsId  },
      data: { market_enable: 'DOWN' }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// PUT /store/goods/goods/delete?goodsId=
router.put('/goods/delete', async (req, res) => {
  let goodsId = req.body.goodsId || req.query.goodsId;

  try {
    await prisma.goods.delete({
      where: { id: goodsId  }
    });
    res.json(resultSuccess());
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

function buildCategoryTree(categories, parent_id = null) {
  return categories
    .filter(cat => (cat.parent_id === parent_id || (cat.parent_id == null && parent_id == null)))
    .map(cat => ({
      ...cat,
      children: buildCategoryTree(categories, cat.id)
    }));
}

// GET /store/goods/label
router.get('/label', async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { sort_order: 'asc' } 
  });
  let categoriesFixCommissionRate = categories.map(cat => ({
    ...cat,
    commission_rate: cat.commission_rate ? parseFloat(cat.commission_rate.toString()) : 0,
  }))
  const tree = buildCategoryTree(categoriesFixCommissionRate);
  const camelCaseResult = camelcaseKeys(tree, { deep: true });
  res.json(resultData(camelCaseResult));
});

// POST /store/goods/label
router.post('/label', async (req, res) => {
  let category = req.body;
  // Kiểm tra parentId nếu không phải root
  if (category.parentId && category.parentId !== '0') {
    const parent = await prisma.category.findUnique({ where: { id: category.parentId } });
    if (!parent) {
      return res.status(400).json(resultError('CATEGORY_PARENT_NOT_EXIST'));
    }
    if (category.level >= 4) {
      return res.status(400).json(resultError('CATEGORY_BEYOND_THREE'));
    }
  }

  try {
    category = snakecaseKeys(category);
    // Ép kiểu các trường Int về số nguyên thay vì string
    let { parent_id, sort_order, level, delete_flag, ...rest } = category;
    if (typeof sort_order === 'string') sort_order = parseInt(sort_order, 10);
    if (typeof level === 'string') level = parseInt(level, 10);
    if (typeof parent_id === 'string' && parent_id !== '0') parent_id = parseInt(parent_id, 10);
    if (typeof delete_flag === 'string') delete_flag = delete_flag === '1' || delete_flag.toLowerCase() === 'true';
    const data = {
      ...rest,
      ...(typeof sort_order === 'number' ? { sort_order } : {}),
      ...(typeof level === 'number' ? { level } : {}),
      ...(typeof delete_flag === 'boolean' ? { delete_flag } : {}),
      ...(parent_id && parent_id !== 0 && parent_id !== '0'
        ? { category: { connect: { id: Number(parent_id) } } }
        : {})
    };
    const created = await prisma.category.create({ data });
    res.json(resultData());
  } catch (err) {
    console.error('CATEGORY_SAVE_ERROR:', err); 
    res.status(400).json(resultError('CATEGORY_SAVE_ERROR', err.message || err));
  }
});

// PUT /store/goods/label
router.put('/label', async (req, res) => {
  let category = req.body;
  if (!category.id) {
    return res.status(400).json(resultError('NO_ID_PROVIDED'));
  }

  const catTemp = await prisma.category.findUnique({ where: { id: category.id } });
  if (!catTemp) {
    return res.status(400).json(resultError('CATEGORY_NOT_EXIST'));
  }

  const parentIdRaw = category.parentId;
  const parentIdInt =
    parentIdRaw !== undefined &&
    parentIdRaw !== null &&
    parentIdRaw !== '' &&
    parentIdRaw !== '0' &&
    parentIdRaw !== 0 &&
    parentIdRaw !== 'null' &&
    !isNaN(Number(parentIdRaw))
      ? parseInt(parentIdRaw, 10)
      : null;

  if (parentIdInt) {
    const parent = await prisma.category.findUnique({ where: { id: parentIdInt } });
    if (!parent) {
      return res.status(400).json(resultError('CATEGORY_PARENT_NOT_EXIST'));
    }
    if (category.level >= 4) {
      return res.status(400).json(resultError('CATEGORY_BEYOND_THREE'));
    }
  }

  try {
    category = snakecaseKeys(category);
    // Ép kiểu các trường Int về số nguyên thay vì string
    let { id, parent_id, sort_order, level, delete_flag, ...rest } = category;
    if (typeof sort_order === 'string') sort_order = parseInt(sort_order, 10);
    if (typeof level === 'string') level = parseInt(level, 10);
    if (typeof parent_id === 'string' && parent_id !== '0' && parent_id !== 'null') parent_id = parseInt(parent_id, 10);
    if (typeof delete_flag === 'string') delete_flag = delete_flag === '1' || delete_flag.toLowerCase() === 'true';
    const connectParent = parent_id && parent_id !== 0 && parent_id !== '0' && parent_id !== 'null' && !isNaN(Number(parent_id));
    const data = {
      ...rest,
      ...(typeof sort_order === 'number' ? { sort_order } : {}),
      ...(typeof level === 'number' ? { level } : {}),
      ...(typeof delete_flag === 'boolean' ? { delete_flag } : {}),
      ...(connectParent ? { category: { connect: { id: Number(parent_id) } } } : {})
    };
    const updated = await prisma.category.update({
      where: { id },
      data
    });
    res.json(resultData(updated));
  } catch (err) {
    console.error('CATEGORY_UPDATE_ERROR:', err);
    res.status(400).json(resultError('CATEGORY_UPDATE_ERROR', err.message || err));
  }
});

// DELETE /store/goods/label/:id
router.delete('/label/:id', async (req, res) => {
  const { id } = req.params;

  // Kiểm tra có category con không
  const children = await prisma.category.findMany({ where: { parent_id: id } });
  if (children && children.length > 0) {
    return res.status(400).json(resultError('CATEGORY_HAS_CHILDREN'));
  }

  // Kiểm tra có hàng hóa thuộc category không
  const goodsCount = await prisma.goods.count({ where: { category_id: id } });
  if (goodsCount > 0) {
    return res.status(400).json(resultError('CATEGORY_HAS_GOODS'));
  }

  await prisma.category.delete({ where: { id } });

  res.json(resultSuccess());
});


module.exports = router;
