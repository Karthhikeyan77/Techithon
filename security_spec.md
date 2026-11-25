# Firestore Security Specification — TECH AUCTION

## 1. Data Invariants
1. A host profile (`/users/{userId}`) can only be read, created, or updated by the authenticated owner (`request.auth.uid == userId`) with verified email (`request.auth.token.email_verified == true`), and users cannot self-escalate to `admin` role.
2. Auction rooms (`/rooms/{roomId}`) belong strictly to `hostUid == request.auth.uid`. Non-owners cannot read, list, modify, or delete another host's room configuration in Firestore.
3. Question bank items (`/questionBankItems/{itemId}`) contain private `correctAnswer` keys and belong strictly to `hostUid == request.auth.uid`. Non-owners are denied read/list/write access to prevent leaking answer keys.
4. Auction archives (`/auctionArchives/{archiveId}`) belong strictly to `hostUid == request.auth.uid` and are immutable once created (`allow update: if false`).
5. `/test/connection` is read-only for connection verification.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. Unauthenticated read on `/rooms/{roomId}` -> PERMISSION_DENIED
2. Unverified email user creating `/users/{uid}` -> PERMISSION_DENIED
3. User creating `/users/{uid}` with `role: 'admin'` -> PERMISSION_DENIED
4. User updating `/users/{uid}` to change `role` or `uid` -> PERMISSION_DENIED
5. Host A reading Host B's `/questionBankItems/{itemId}` (answer key leak) -> PERMISSION_DENIED
6. Blanket `list` on `/rooms` without `where('hostUid', '==', uid)` -> PERMISSION_DENIED
7. Shadow field injection (`isVerified: true`) on `/rooms/{roomId}` create -> PERMISSION_DENIED
8. Oversized 200KB string in `/rooms/{roomId}` `name` field -> PERMISSION_DENIED
9. Invalid document ID (`../../../etc/passwd`) on `/rooms/{roomId}` -> PERMISSION_DENIED
10. Host A updating `hostUid` on `/rooms/{roomId}` to steal or transfer ownership -> PERMISSION_DENIED
11. Mutating an immutable `/auctionArchives/{archiveId}` record -> PERMISSION_DENIED
12. Client forging `createdAt` timestamp instead of `request.time` -> PERMISSION_DENIED
