/**
 * Mapper: PddPromotionUrlItem (来自 pdd.ddk.goods.promotion.url.generate 或 goods.detail)
 *         → AffiliateLink[]
 *
 * PDD 只有一个 resolve 路径(unlike JD 的 A/B 双策略),因此本文件是 PDD 唯一的 link mapper。
 * 与 alimama / JD 同位 mapper 的差异:
 *   - PDD 一条 PromotionUrlItem 包含多种形态的 affiliate URL(short_url / mobile_short_url
 *     / we_app_web_view_short_url / qq_app_web_view_short_url),按用户场景挑一条做主链
 *   - PDD 没有 "couponLink 与主链分离" 的概念,券逻辑直接 baked 进 short_url 里
 *
 * 规则:
 *   - 主链优先用 short_url (p.pinduoduo.com/xxx) ← OCP 通用首选
 *   - short_url 缺失时 fallback 到 mobile_short_url → url (长链)
 *   - we_app / qq_app 短链是微信/QQ 专属场景,作为附加 link 输出(便于多端 Agent 选择)
 *   - 都缺失 → 返空数组 (resolve 把 link_count=0,live_check=unknown)
 */
import type { PddPromotionUrlItem } from '../pdd/types';

export interface AffiliateLink {
  link_id: string;
  label: string;
  url: string;
  description?: string;
}

function affiliateLink(input: AffiliateLink): AffiliateLink {
  return {
    link_id: input.link_id,
    label: input.label,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
  };
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function promotionUrlToAffiliateLinks(
  item: PddPromotionUrlItem | null | undefined,
): AffiliateLink[] {
  if (!item) return [];

  const links: AffiliateLink[] = [];

  // ---- 主链: short_url > mobile_short_url > url ----
  const primary =
    nonEmpty(item.short_url) ??
    nonEmpty(item.mobile_short_url) ??
    nonEmpty(item.url);

  if (!primary) return [];

  links.push(
    affiliateLink({
      link_id: 'buy_now',
      label: '去拼多多购买',
      url: primary,
      description: 'Open a PDD Duoduojinbao PID-attributed purchase URL.',
    }),
  );

  // ---- 微信小程序短链(独立场景,与主链不同时输出) ----
  const weApp = nonEmpty(item.we_app_web_view_short_url);
  if (weApp && weApp !== primary) {
    links.push(
      affiliateLink({
        link_id: 'buy_in_wechat',
        label: '在微信内购买',
        url: weApp,
        description: 'Open inside WeChat via PDD mini-program webview.',
      }),
    );
  }

  // ---- QQ 小程序短链(同上) ----
  const qqApp = nonEmpty(item.qq_app_web_view_short_url);
  if (qqApp && qqApp !== primary && qqApp !== weApp) {
    links.push(
      affiliateLink({
        link_id: 'buy_in_qq',
        label: '在 QQ 内购买',
        url: qqApp,
        description: 'Open inside QQ via PDD mini-program webview.',
      }),
    );
  }

  return links;
}
