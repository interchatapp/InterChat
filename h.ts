import db from "./src/utils/Db.js";
const hubs = await db.hub.findMany({ where: { private: false }, include: { _count: { select: { connections: { where: { connected: true } } } } } })

const toPrivate = hubs.filter(hub => hub._count.connections <= 2)

await db.hub.updateMany({ where: { id: { in: toPrivate.map(hub => hub.id) } }, data: { private: true } }).then(console.log)
