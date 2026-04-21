# 提供方流程（Provider Flow）

这个示例流程展示 commerce provider 如何接入 catalog。

## 生命周期

```text
Provider startup
-> 获取 catalog manifest
-> 查看 object contracts
-> 查看 provider_contract.sync_capabilities
-> 提交 ProviderRegistration
-> 收到 RegistrationResult
-> 如果选中的是 catalog-hosted push，则同步 CommercialObject batch
```

## 当前仓库行为

在当前 workspace 中：

- provider admin API 可以 seed demo products
- provider 可以向 commerce catalog 注册
- catalog 会协商 `ocp.push.batch`
- provider 随后把 product object 发布到 catalog
- full sync run 会被记录并展示在 provider admin UI 中

## 重要规则

Provider 必须在选中的 registration version 已生效后，sync 才会成功。

这条规则保证 catalog 不会接受基于 stale declaration 的对象。
