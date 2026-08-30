import type { CardScript } from "@fyendal/engine";
import { oneHp } from "./1hp.js";
import { aac } from "./aac.js";
import { aaz } from "./aaz.js";
import { agb } from "./agb.js";
import { aha } from "./aha.js";
import { aio } from "./aio.js";
import { ajv } from "./ajv.js";
import { ako } from "./ako.js";
import { ama } from "./ama.js";
import { amo } from "./amo.js";
import { amx } from "./amx.js";
import { aol } from "./aol.js";
import { apr } from "./apr.js";
import { aps } from "./aps.js";
import { arc } from "./arc.js";
import { ark } from "./ark.js";
import { arr } from "./arr.js";
import { asb } from "./asb.js";
import { asr } from "./asr.js";
import { ast } from "./ast.js";
import { aur } from "./aur.js";
import { azs } from "./azs.js";
import { bdd } from "./bdd.js";
import { bol } from "./bol.js";
import { chn } from "./chn.js";
import { cru } from "./cru.js";
import { ddd } from "./ddd.js";
import { dro } from "./dro.js";
import { dtd } from "./dtd.js";
import { dvr } from "./dvr.js";
import { dyn } from "./dyn.js";
import { ele } from "./ele.js";
import { evo } from "./evo.js";
import { evr } from "./evr.js";
import { fab } from "./fab.js";
import { gem } from "./gem.js";
import { hnt } from "./hnt.js";
import { hvy } from "./hvy.js";
import { iar } from "./iar.js";
import { jdg } from "./jdg.js";
import { lev } from "./lev.js";
import { lgs } from "./lgs.js";
import { lss } from "./lss.js";
import { mon } from "./mon.js";
import { mpa } from "./mpa.js";
import { mpg } from "./mpg.js";
import { mpw } from "./mpw.js";
import { mst } from "./mst.js";
import { omn } from "./omn.js";
import { out } from "./out.js";
import { pen } from "./pen.js";
import { psm } from "./psm.js";
import { rnr } from "./rnr.js";
import { ros } from "./ros.js";
import { rvd } from "./rvd.js";
import { sar } from "./sar.js";
import { saz } from "./saz.js";
import { sba } from "./sba.js";
import { sbl } from "./sbl.js";
import { sbr } from "./sbr.js";
import { sbz } from "./sbz.js";
import { sda } from "./sda.js";
import { sdo } from "./sdo.js";
import { sea } from "./sea.js";
import { sen } from "./sen.js";
import { sfa } from "./sfa.js";
import { sgb } from "./sgb.js";
import { siy } from "./siy.js";
import { ska } from "./ska.js";
import { sly } from "./sly.js";
import { sup } from "./sup.js";
import { svi } from "./svi.js";
import { tcc } from "./tcc.js";
import { ter } from "./ter.js";
import { upr } from "./upr.js";
import { wtr } from "./wtr.js";

const setModules: Record<string, Record<string, CardScript>> = {
  "1HP": oneHp,
  AAC: aac,
  AAZ: aaz,
  AGB: agb,
  AHA: aha,
  AIO: aio,
  AJV: ajv,
  AKO: ako,
  AMA: ama,
  AMO: amo,
  AMX: amx,
  AOL: aol,
  APR: apr,
  APS: aps,
  ARC: arc,
  ARK: ark,
  ARR: arr,
  ASB: asb,
  ASR: asr,
  AST: ast,
  AUR: aur,
  AZS: azs,
  BDD: bdd,
  BOL: bol,
  CHN: chn,
  CRU: cru,
  DDD: ddd,
  DRO: dro,
  DTD: dtd,
  DVR: dvr,
  DYN: dyn,
  ELE: ele,
  EVO: evo,
  EVR: evr,
  FAB: fab,
  GEM: gem,
  HNT: hnt,
  HVY: hvy,
  IAR: iar,
  JDG: jdg,
  LEV: lev,
  LGS: lgs,
  LSS: lss,
  MON: mon,
  MPA: mpa,
  MPG: mpg,
  MPW: mpw,
  MST: mst,
  OMN: omn,
  OUT: out,
  PEN: pen,
  PSM: psm,
  RNR: rnr,
  ROS: ros,
  RVD: rvd,
  SAR: sar,
  SAZ: saz,
  SBA: sba,
  SBL: sbl,
  SBR: sbr,
  SBZ: sbz,
  SDA: sda,
  SDO: sdo,
  SEA: sea,
  SEN: sen,
  SFA: sfa,
  SGB: sgb,
  SIY: siy,
  SKA: ska,
  SLY: sly,
  SUP: sup,
  SVI: svi,
  TCC: tcc,
  TER: ter,
  UPR: upr,
  WTR: wtr,
};

/**
 * Scripts keyed by functional identity (`functionalKey(name, pitch)`), so a
 * reprint in another set resolves to the same script. The loader in
 * ../index.ts expands this registry to per-printing ids for the engine.
 */
export const registry: Record<string, CardScript> = {};

for (const [set, mod] of Object.entries(setModules)) {
  for (const [key, script] of Object.entries(mod)) {
    if (key in registry) {
      throw new Error(`duplicate functional script key "${key}" (set module ${set})`);
    }
    registry[key] = script;
  }
}
