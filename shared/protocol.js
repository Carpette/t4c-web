// Protocole réseau : snapshots binaires (état des entités) + JSON (événements).
// Format snapshot (serveur -> client) :
//   u8  0x01
//   f32 worldTime
//   u16 nbEntités
//   par entité : u32 id | u8 kind | f32 x | f32 z | f32 dir | u8 state | u8 hp% | u8 level  (20 octets)
//   u16 nbDisparues | u32 id...

export const BIN_SNAPSHOT = 0x01;
const ENT_BYTES = 20;

export function encodeSnapshot(worldTime, entities, gone) {
  const buf = new ArrayBuffer(1 + 4 + 2 + entities.length * ENT_BYTES + 2 + gone.length * 4);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, BIN_SNAPSHOT); o += 1;
  v.setFloat32(o, worldTime, true); o += 4;
  v.setUint16(o, entities.length, true); o += 2;
  for (const e of entities) {
    v.setUint32(o, e.id, true); o += 4;
    v.setUint8(o, e.kind); o += 1;
    v.setFloat32(o, e.x, true); o += 4;
    v.setFloat32(o, e.z, true); o += 4;
    v.setFloat32(o, e.dir, true); o += 4;
    v.setUint8(o, e.state); o += 1;
    v.setUint8(o, e.hpPct); o += 1;
    v.setUint8(o, Math.min(255, e.level || 0)); o += 1;
  }
  v.setUint16(o, gone.length, true); o += 2;
  for (const id of gone) { v.setUint32(o, id, true); o += 4; }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  let o = 1; // saute le type
  const worldTime = v.getFloat32(o, true); o += 4;
  const count = v.getUint16(o, true); o += 2;
  const entities = new Array(count);
  for (let i = 0; i < count; i++) {
    entities[i] = {
      id: v.getUint32(o, true),
      kind: v.getUint8(o + 4),
      x: v.getFloat32(o + 5, true),
      z: v.getFloat32(o + 9, true),
      dir: v.getFloat32(o + 13, true),
      state: v.getUint8(o + 17),
      hpPct: v.getUint8(o + 18),
      level: v.getUint8(o + 19),
    };
    o += ENT_BYTES;
  }
  const goneCount = v.getUint16(o, true); o += 2;
  const gone = new Array(goneCount);
  for (let i = 0; i < goneCount; i++) { gone[i] = v.getUint32(o, true); o += 4; }
  return { worldTime, entities, gone };
}
