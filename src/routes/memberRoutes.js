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

// GET /manager/passport/member
router.get('/member', async (req, res) => {
  const { username, nickName, mobile,...searchParams } = req.query; 
  const page = parseInt(req.query.pageNum) || 1;
  const size = parseInt(req.query.pageSize) || 10;

  const where = {};
  if (username) where.username = { contains: username };
  if (nickName) where.nick_name = { contains: nickName };
  if (mobile) where.mobile = { contains: mobile };

  const [records, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * size,
      take: size,
      orderBy: { id: 'desc' }
    }),
    prisma.user.count({ where })
  ]);

  const modifiedRecords = records.map(record => {
    let formatted = { ...record };
    if (formatted.create_time) {
      const date = new Date(formatted.create_time);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formatted.create_time = `${day}-${month}-${year}`;
    }
    if (formatted.birthday) {
      const date = new Date(formatted.birthday);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formatted.birthday = `${day}-${month}-${year}`;
    }
    return formatted;
  });

const result = {
  records: modifiedRecords,
  total,
  size,
  current: page,
  pages: Math.ceil(total / size)
};
const camelCaseResult = camelcaseKeys(result, { deep: true });
  res.json(resultData(camelCaseResult));
});

// GET /manager/passport/member/:id
router.get('/member/:id', async (req, res) => {
  const { id } = req.params;
  const member = await prisma.user.findUnique({
    where: { id: id }
  });
  if (!member) {
    return res.status(404).json({ message: 'User not found' });
  }
  const modifiedMember = {
  ...member,
  password:null,
};
  const camelCaseResult = camelcaseKeys(modifiedMember, { deep: true });
  res.json(resultData(camelCaseResult));
});

// POST /manager/passport/member
router.post('/member', async (req, res) => {
  const member = { ...req.body, create_time: new Date() };
  try {
    const created = await prisma.user.create({
      data: member
    });
    const modifiedMember = {
      ...created,
    };
    const camelCaseResult = camelcaseKeys(modifiedMember, { deep: true });

    res.json(resultData(camelCaseResult));
  } catch (err) {
    res.status(400).json({
      code: 400,
      message: err.message,
      data: null
    });
  }
});

// PUT /manager/passport/member/updateMemberStatus
router.put('/member/updateMemberStatus', async (req, res) => {
  const memberIds = req.body.memberIds || req.query.memberIds;
  const disabled = req.body.disabled ?? req.query.disabled;

  if (typeof disabled === 'undefined') {
    return res.status(400).json({ code: 400, message: 'disabled (boolean) là bắt buộc', data: null });
  }

  // Nếu disabled là string, convert sang boolean
  const disabledBool = (disabled === true || disabled === 'true');
  const users = await prisma.user.findMany({
  where: { id: memberIds  },
  select: { id: true, disabled: true }
});

const updatePromises = users.map(user => 
  prisma.user.update({
    where: { id: user.id },
    data: { disabled: !user.disabled }
  })
);

  await Promise.all(updatePromises);

  res.json(resultSuccess());
});

// PUT /manager/passport/member
router.put('/member', async (req, res) => {
  let member = { ...req.body };
  if (!member.id) {
    return res.status(400).json({ code: 400, message: 'Thiếu id user', data: null });
  }
  if (member.birthday) {
    member.birthday = new Date(member.birthday);  
  }
  member = snakecaseKeys(member);
  const updated = await prisma.user.update({
    where: { id: member.id },
    data: {
      ...member
    }
  });
    const modifiedMember = {
          ...updated,
    };
    const camelCaseResult = camelcaseKeys(modifiedMember, { deep: true });
  res.json(resultData(camelCaseResult));
});

// GET /manager/member/address/:memberId
router.get('/member/address/:memberId', async (req, res) => {
  const memberId = req.params.memberId;
  const pageNum = parseInt(req.query.pageNum) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const [records, total] = await Promise.all([
    prisma.user_address.findMany({
      where: { user_id: memberId },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
      orderBy: { id: 'desc' }
    }),
    prisma.user_address.count({ where: { user_id: memberId } })
  ]);
  
  const modifiedRecords = records.map(record => ({
    ...record,
    deleteFlag: false,
    memberId: record.user_id,
  }));
  const result = {
    records: modifiedRecords,
    total,
    size: pageSize,
    current: pageNum,
    pages: Math.ceil(total / pageSize)
  };
  const camelCaseResult = camelcaseKeys(result, { deep: true });
  res.json(resultData(camelCaseResult));
});

// GET /manager/member/evaluation/getByPage
router.get('/member/evaluation/getByPage', async (req, res) => {
  const { pageNum = 1, pageSize = 10, memberName, ...otherParams } = req.query;

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

// GET /manager/member/evaluation/get/:id
router.get('/member/evaluation/get/:id', async (req, res) => {
  const { id } = req.params;
  const evaluation = await prisma.user_evaluation.findUnique({
    where: { id: Number(id) },
    include: {
      goods: {
        select: {
          goods_name: true,
          goods_gallery: {
            select: { original: true },
            take: 1
          }
        }
      },
      user: { select: { username: true ,face:true} },
      store: { select: { store_name: true } }
    }
  });

  // Lấy goodsImage từ goods.goods_gallery[0].original nếu có, nếu không thì null
  let goodsImage = null;
  if (evaluation?.goods?.goods_gallery && evaluation.goods.goods_gallery.length > 0) {
    goodsImage = evaluation.goods.goods_gallery[0].original;
  }
  const goodsName = evaluation?.goods?.goods_name || null;
  const username = evaluation?.user?.username || null;
  const storeName = evaluation?.store?.store_name || null;
  const memberProfile = evaluation?.user?.face || null;

  const camelCaseResult = camelcaseKeys({
    ...evaluation,
    goodsName,
    goodsImage,
    username,
    storeName,
    memberProfile
  }, { deep: true });

  res.json(resultData(camelCaseResult));
});

// GET /manager/member/evaluation/updateStatus/:id?status=
router.get('/member/evaluation/updateStatus/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  if (!id || !status) {
    return res.status(400).json({ code: 400, message: 'Thiếu id hoặc status', data: null });
  }

  await prisma.user_evaluation.update({
    where: { id },
    data: { status:status}
  });

  res.json(resultSuccess());
});

// PUT /manager/member/evaluation/delete/:id
router.put('/member/evaluation/delete/:id', async (req, res) => {
  const { id } = req.params;

  await prisma.user_evaluation.delete({
    where: { id }
  });

  res.json(resultSuccess());
});

// GET /manager/statistics/index
router.get('/statistics/index', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Tổng số lượng sản phẩm
    const totalGoods = await prisma.goods.count();

    // Tổng số lượng user
    const totalUsers = await prisma.user.count();

    // Tổng số lượng order
    const totalOrders = await prisma.order.count();

    // Tổng số lượng store
    const totalStores = await prisma.store.count();

    // Đơn hàng tạo hôm nay
    const todayOrders = await prisma.order.count({
      where: {
        create_time: { gte: today }
      }
    });

    // Tổng doanh số hôm nay (tính tổng goods_price của order tạo hôm nay)
    const todaySalesResult = await prisma.order.aggregate({
      _sum: { goods_price: true },
      where: { create_time: { gte: today } }
    });
    const todaySales = todaySalesResult._sum.goods_price && typeof todaySalesResult._sum.goods_price.toNumber === 'function'
      ? todaySalesResult._sum.goods_price.toNumber()
      : Number(todaySalesResult._sum.goods_price) || 0;

    // Store mới hôm nay
    const newStoresToday = await prisma.store.count({
      where: { create_time: { gte: today } }
    });

    // Thành viên mới hôm nay
    const newMembersToday = await prisma.user.count({
      where: { create_time: { gte: today } }
    });

    // Bình luận mới hôm nay
    const newCommentsToday = await prisma.user_evaluation.count({
      where: { create_time: { gte: today } }
    });

    const statistics = {
      goodsNum: totalGoods,
      memberNum: totalUsers,
      orderNum: totalOrders,
      storeNum: totalStores,
      todayOrderNum: todayOrders,
      todayOrderPrice: todaySales,
      todayStoreNum: newStoresToday,
      todayStoreNum: newMembersToday,
      todayMemberEvaluation: newCommentsToday
    };

    res.json(resultData(statistics));
  } catch (e) {
    res.json({ code: 500, message: 'Error in getting home page query data', data: null });
  }
});

// GET /manager/statistics/index/goodsStatistics
router.get('/statistics/index/goodsStatistics', async (req, res) => {
  try {
    // Lấy top 10 sản phẩm bán chạy nhất theo tổng số lượng bán ra (num)
    const topGoods = await prisma.order_item.groupBy({
      by: ['goods_id'],
      _sum: { num: true, sub_total: true },
      orderBy: { _sum: { num: 'desc' } },
      take: 10,
    });

    // Lấy thông tin tên sản phẩm cho từng goods_id
    const goodsIds = topGoods.map(g => g.goods_id).filter(Boolean);
    const goodsInfo = await prisma.goods.findMany({
      where: { id: { in: goodsIds } },
      select: { id: true, goods_name: true }
    });
    const goodsMap = {};
    goodsInfo.forEach(g => { goodsMap[g.id] = g.goods_name; });

    const goods = topGoods.map(g => ({
      goodsId: g.goods_id?.toString(),
      goodsName: goodsMap[g.goods_id] || null,
      num: g._sum.num || 0,
      price: g._sum.sub_total && typeof g._sum.sub_total.toNumber === 'function'
        ? g._sum.sub_total.toNumber()
        : Number(g._sum.sub_total) || 0
    }));
    res.json(resultData(goods));
  } catch (e) {
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

// GET /manager/statistics/index/storeStatistics
router.get('/statistics/index/storeStatistics', async (req, res) => {
  try {
    // Lấy tất cả sub_order, mỗi sub_order đã có store_id, sub_total
    const subOrders = await prisma.sub_order.findMany({
      include: {
        store: { select: { id: true, store_name: true } },
        order_item: true
      }
    });

    // Duyệt qua từng sub_order, cộng dồn tổng doanh thu (sub_total) và tổng số lượng bán ra cho từng cửa hàng
    const storeSalesMap = {};
    const storeNumMap = {};
    for (const sub of subOrders) {
      const storeId = sub.store_id;
      if (!storeId) continue;
      const subTotal = sub.sub_total && typeof sub.sub_total.toNumber === 'function'
        ? sub.sub_total.toNumber()
        : Number(sub.sub_total) || 0;
      if (!storeSalesMap[storeId]) {
        storeSalesMap[storeId] = 0;
      }
      storeSalesMap[storeId] += subTotal;

      // Tổng số lượng bán ra
      if (!storeNumMap[storeId]) {
        storeNumMap[storeId] = 0;
      }
      const totalNum = (sub.order_item || []).reduce((sum, item) => sum + (item.num || 0), 0);
      storeNumMap[storeId] += totalNum;
    }

    // Sắp xếp và lấy top 10
    const sortedStores = Object.entries(storeSalesMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const storeIds = sortedStores.map(([storeId]) => BigInt(storeId));

    // Lấy thông tin tên store cho từng store_id
    const storeInfo = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, store_name: true }
    });
    const storeMap = {};
    storeInfo.forEach(s => { storeMap[s.id] = s.store_name; });

    const stores = sortedStores.map(([storeId, totalSales]) => {
      return {
        storeId: storeId.toString(),
        storeName: storeMap[BigInt(storeId)] || null,
        price: totalSales,
        num: storeNumMap[storeId] || 0
      };
    });
    res.json(resultData(stores));
  } catch (e) {
    console.error('Error in getting store statistics:', e);
    res.json({ code: 500, message: 'Internal server error', data: null });
  }
});

module.exports = router;
