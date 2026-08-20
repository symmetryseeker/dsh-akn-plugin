# ADR-0011：必需 Attestation 对象需要显式的 prepared-digest 阶段

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-20
- 影响：Protocol SDK、Revocation/Promotion/Federation 等签名对象构造

## 问题

Revocation Schema 要求顶层 `attestation`，但 attestation 的 in-toto subject 又必须绑定 Revocation digest。Digest 按规范排除顶层 attestation，因此正确顺序是：验证无 digest/signature 的业务正文 → 计算 digest → 签名该 digest → 附加 attestation → published 校验。

现有 `finalizeProtocolObject()` 在计算 digest 后立即执行 published Schema 校验；对于必需 attestation 的对象，它在签名机会出现前必然失败。使用伪造占位签名会破坏 subject binding，跳过最终校验则会破坏 conformance。

## 决策

Protocol SDK 增加 `prepareProtocolObject()`：它只完成严格 pre-digest Schema/limits/capability 校验并附加规范 digest。调用者必须随后生成真实 attestation、附加到对象，再调用 `validateProtocolObject()`。`finalizeProtocolObject()` 保持用于无需必需顶层签名或签名可选的对象。

prepared 对象不是新的 wire object 或可发布状态；没有通过 published validator 就不得持久化、传输或进入 Hub。

## 后果

- Revocation 可以在不伪造签名的前提下按规范构造。
- 摘要内容和排除字段规则不变。
- 测试必须证明 prepared Revocation 本身不通过 published validation，附加正确签名后通过，篡改后失败。
