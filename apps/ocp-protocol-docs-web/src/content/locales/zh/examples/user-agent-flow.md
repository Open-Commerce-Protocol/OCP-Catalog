# 用户与 Agent 流程

这个流程展示的是用户侧 agent 如何消费协议。

## 生命周期

```text
用户表达意图
-> agent 检查本地保存的 catalog profile
-> 如果为空，agent 搜索 Center
-> agent 选择候选 catalog
-> 用户确认是否注册到本地
-> agent 查询 catalog
-> agent resolve 选中的结果
```

## 当前仓库实现

当前 user demo 做了两件重要的事：

- 不直接把 raw tool result 扔给用户
- 先让 agent 消化 Center 和 Catalog 的返回，再转述给用户

## 为什么 Center 和 Catalog 要分开

Agent 先解决的是：

> 我应该用哪个 Catalog？

然后再解决：

> 这个 Catalog 里我应该展示哪个商品？

这正是协议拆成两层的意义。
