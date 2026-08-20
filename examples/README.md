# AEN examples

这里的示例用于把协议对象、CLI 和真实工作流连接起来。示例会明确区分：

- 可复现的合成输入；
- 从当前实现得到的真实输出形态；
- 尚未完成的真实模型或跨用户 Pilot 结论。

## 当前示例

- [DeepSeek Harness 失败恢复](./failure-recovery/README.md)：从一份脱敏 DSH session 导入 Episode，形成 H1 私有 Experience，并通过 Card/section 渐进消费。

协议层的最小有效和无效对象还可以在 [`conformance/valid`](../conformance/valid) 与 [`conformance/invalid`](../conformance/invalid) 中找到。它们用于验证 Schema、digest、签名和引用规则，不承担产品教程的职责。
