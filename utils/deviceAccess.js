const mongoose = require('mongoose');
const Device = require('../models/Device');
const User = require('../models/User');

async function getManagedUserIds(user) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'retailer') return [user._id];

  const ids = [user._id];
  const visited = new Set([String(user._id)]);
  let parentIds = [user._id];

  while (parentIds.length) {
    const children = await User.find({
      parentId: { $in: parentIds },
      isDeleted: { $ne: true },
    }).select('_id');

    const unseen = children.filter((child) => !visited.has(String(child._id)));
    if (!unseen.length) break;

    unseen.forEach((child) => {
      visited.add(String(child._id));
      ids.push(child._id);
    });
    parentIds = unseen.map((child) => child._id);
  }

  return ids;
}

async function getDeviceScope(user) {
  const managedIds = await getManagedUserIds(user);
  return managedIds === null ? {} : { retailerId: { $in: managedIds } };
}

function identifierCondition(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;

  const conditions = [{ deviceId: value }];
  if (mongoose.isValidObjectId(value)) conditions.unshift({ _id: value });
  return { $or: conditions };
}

async function findAccessibleDevice(user, identifier, projection = null) {
  const idCondition = identifierCondition(identifier);
  if (!idCondition) return null;

  const scope = await getDeviceScope(user);
  const query = Object.keys(scope).length
    ? { $and: [scope, idCondition] }
    : idCondition;

  const finder = Device.findOne(query);
  return projection ? finder.select(projection) : finder;
}

module.exports = {
  findAccessibleDevice,
  getDeviceScope,
  getManagedUserIds,
  identifierCondition,
};
