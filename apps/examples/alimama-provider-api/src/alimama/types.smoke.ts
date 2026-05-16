/**
 * 冒烟测试：编译期验证 fixture JSON 真的匹配 types 接口。
 * 这个文件只为 typecheck 用，不在运行时跑（无副作用）。
 *
 * 若 fixture 漂移或 types 漏字段，typecheck 会立刻报错。
 */
import fixture from '../../tests/fixtures/material-optional-sample.json';
import type {
  AlimamaErrorResponse,
  AlimamaMaterialResponse,
  AlimamaPrivilegeResponse,
} from './types';
import { isAlimamaError } from './types';

// 1. fixture 整体匹配 AlimamaMaterialResponse
const _typedFixture: AlimamaMaterialResponse = fixture;

// 2. 抽一条 item 验证关键字段类型
const _firstItem = _typedFixture.tbk_dg_material_optional_response.result_list.map_data[0]!;
const _title: string = _firstItem.title;
const _userType: number = _firstItem.user_type;
const _price: string = _firstItem.zk_final_price; // 注意是字符串

// 3. small_images 三种形态都得过类型
const _shape1: { string: string[] } | null | undefined = _firstItem.small_images;

// 4. type guard 工作
function _guardCheck(res: unknown): string {
  if (isAlimamaError(res)) {
    const err: AlimamaErrorResponse = res;
    return err.error_response.sub_code ?? err.error_response.msg;
  }
  return 'ok';
}

// 5. PrivilegeResponse 形状没拼错
const _samplePriv: AlimamaPrivilegeResponse = {
  tbk_privilege_get_response: {
    result: {
      data: {
        coupon_click_url: 'https://s.click.taobao.com/xxx',
        item_url: 'https://s.click.taobao.com/yyy',
        coupon_info: '满 99 减 10',
      },
    },
  },
};

export {};
