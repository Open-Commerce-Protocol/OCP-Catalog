# Provider 流程

这个流程展示的是电商 provider 如何接入 catalog。

## 生命周期

```text
Provider 启动
-> 拉取 catalog manifest
-> 检查 object contracts
-> 提交 ProviderRegistration
-> 收到 RegistrationResult
-> 分批同步 CommercialObject
```

## 当前仓库中的行为

在当前 workspace 中：

- provider admin API 可以初始化 demo 商品
- provider 可以注册到 commerce catalog
- provider 随后把商品对象发布进 catalog
- full sync run 会被记录，并显示在 provider admin UI 中

## 重要约束

只有当 provider 在目标 registration version 上已经处于 active 状态时，sync 才会成功。

这条规则的作用是防止 catalog 在过期声明之上接收对象。
