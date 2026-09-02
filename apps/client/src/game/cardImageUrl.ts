const IMG_BASE = "https://content.fabrary.net/cards";

/** Fabrary has no plain image objects for some printings. Prefer an exact
 * foil object; where no exact object exists, use a verified printing of the
 * same functional card without changing card data. */
const FABRARY_IMAGE_ID_OVERRIDES: Readonly<Record<string, string>> = {
  AOL004: "AOL004-RF",
  AOL005: "AOL005-RF",
  AOL006: "AOL006-RF",
  AMA001: "AMA001-RF",
  AMA002: "AMA002-RF",
  AMA003: "AMA003-RF",
  AMA005: "AMA005-RF",
  AMA006: "AMA006-RF",
  AMO001: "AMO001-RF",
  AZS001: "AZS001-RF",
  AZS002: "AZS002-RF",
  AZS003: "AZS003-RF",
  AZS004: "AZS004-RF",
  AZS005: "AZS005-RF",
  AZS006: "AZS006-RF",
  CON001: "CON001-RF",
  CON002: "CON002-RF",
  CON003: "CON003-RF",
  CON004: "CON004-RF",
  FAB337: "SEA080",
  FAB338: "SEA095",
  FAB414: "PEN299",
  FAB464: "FAB464-MV",
  FAB465: "FAB465-MV",
  FAB466: "FAB466-MV",
  FAB469: "FAB469-CF",
  FAB470: "OMN203",
  FAB471: "FAB471-RF",
  FAB472: "FAB472-RF",
  FAB473: "FAB473-RF",
  FAB475: "FAB475-RF",
  FAB476: "FAB476-RF",
  FAB477: "FAB477-RF",
  FAB481: "FAB481-RF",
  FAB482: "FAB482-RF",
  FAB483: "FAB483-RF",
  FAB484: "FAB484-RF",
  FAB485: "FAB485-RF",
  FAB486: "FAB486-RF",
  FAB487: "FAB487-RF",
  FAB489: "FAB489-MV",
  GEM105: "GEM105-MV",
  GEM110: "GEM110-CF",
  GEM112: "GEM112-RF",
  GEM141: "GEM141-MV",
  GEM142: "GEM142-CF",
  GEM143: "GEM143-CF",
  GEM144: "GEM144-CF",
  GEM145: "GEM145-CF",
  GEM146: "GEM146-CF",
  GEM147: "GEM147-CF",
  GEM148: "GEM148-CF",
  GEM149: "GEM149-RF",
  GEM164: "GEM164-RF",
  HER135: "HER135-RF",
  HER147: "HER147-RF",
  HER148: "HER148-RF",
  HER149: "HER149-RF",
  HER160: "HER160-MV",
  HER167: "HER167-MV",
  IAR083: "AMA026",
  IAR091: "IAR091-RF",
  IAR159: "IAR159-RF",
  IAR222: "IAR222-MV",
  IAR666: "IAR666-MV",
  JDG062: "JDG062-CF",
  LGS395: "LGS395-CF",
  LGS396: "LGS396-RF",
  LGS397: "LGS397-RF",
  LGS400: "LGS400-RF",
  LGS451: "LGS451-MV",
  LGS452: "LGS452-CF",
  LGS453: "LGS453-CF",
  LGS454: "LGS454-CF",
  LGS455: "LGS455-CF",
  LGS457: "LGS457-CF",
  LGS458: "LGS458-RF",
  LSS023: "LSS023-RF",
  LSS024: "LSS024-CF",
  MPA002: "MPA002-MV",
  MPG129: "MPG129-CF",
  MPW010: "MPW010-RF",
  MPW011: "MPW011-RF",
  MPW012: "MPW012-RF",
  MPW155: "MPW155-MV",
  MPW156: "MPW156-MV",
  OMN000: "OMN000-RF",
  OMN086: "OMN086-RF",
  OMN141: "OMN141-RF",
  OMN242: "OMN242-RF",
  OMN248: "OMN248-CF",
  OMN249: "OMN249-CF",
  OMN250: "OMN250-CF",
  RHI001: "RHI001-RF",
  ROS254: "ROS254-MV",
  ROS255: "ROS255-MV",
  ROS256: "ROS256-MV",
  ROS257: "AJV028",
};

/** Functionally identical token printings may have different art. Keep tokens
 * whose instances routinely move between grouped and individual views on one
 * deterministic image so resolving one cannot change the remaining art. */
const CANONICAL_TOKEN_ART_IDS: Readonly<Record<string, string>> = {
  "runechant|0": "ARC112",
  "toughness|0": "APS032",
};

/** Older double-sided/token records are stored with a trailing B in card data,
 * but Fabrary serves that face at the unsuffixed collector number. Newer
 * double-sided cards use `<collector>_BACK.webp` instead. */
const FABRARY_BACK_FACE_AT_BASE_ID: ReadonlySet<string> = new Set([
  "ARC114B",
  "ARC115B",
  "DYN092B",
  "ELE111B",
  "ELE202B",
  "ELE222B",
  "LGS282B",
  "LGS283B",
  "LGS284B",
  "LGS285B",
  "LGS286B",
  "LGS287B",
  "LGS288B",
  "LGS289B",
  "MON105B",
  "MON106B",
  "MON220B",
  "MON221B",
  "WTR075B",
  "WTR076B",
  "WTR113B",
  "WTR114B",
  "WTR225B",
]);

export interface CardImageData {
  cardType: string;
  name: string;
  pitch?: number;
}

/** Resolve the exact Fabrary URL used by the client for a printing. */
export function resolveCardImageUrl(cardId: string, data?: CardImageData): string {
  const tokenKey = data?.cardType === "token"
    ? `${data.name.trim().toLowerCase().replace(/\s+/g, " ")}|${data.pitch ?? 0}`
    : undefined;
  const artCardId = tokenKey ? CANONICAL_TOKEN_ART_IDS[tokenKey] ?? cardId : cardId;
  let imageId = FABRARY_IMAGE_ID_OVERRIDES[artCardId] ?? artCardId;
  if (artCardId.endsWith("B")) {
    const baseId = artCardId.slice(0, -1);
    imageId = FABRARY_BACK_FACE_AT_BASE_ID.has(artCardId) ? baseId : `${baseId}_BACK`;
  }
  return `${IMG_BASE}/${imageId}.webp`;
}

/** Candidate Fabrary objects for a printing. IAR preview assets can arrive
 * after card data, so temporarily try the common foil objects before the UI
 * falls back to its text-card presentation. */
export function resolveCardImageUrls(cardId: string, data?: CardImageData): string[] {
  const primary = resolveCardImageUrl(cardId, data);
  if (!/^IAR\d{3}$/.test(cardId)) return [primary];
  return [...new Set([
    primary,
    `${IMG_BASE}/${cardId}.webp`,
    `${IMG_BASE}/${cardId}-RF.webp`,
    `${IMG_BASE}/${cardId}-CF.webp`,
    `${IMG_BASE}/${cardId}-MV.webp`,
  ])];
}
