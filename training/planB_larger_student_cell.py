# ===== PLAN B CELL (only if the first student's test accuracy is low) =====
# Paste as a new cell after the evaluation cell and run it, then re-run the evaluation, export and zip cells.
# A larger student (MobileNetV3-Large, ~4.2M params, ~4-5 MB INT8), trained longer, with a lower learning rate for the
# pretrained backbone than for the new classifier head.
student = timm.create_model('mobilenetv3_large_100', pretrained=True, num_classes=len(CLASSES), drop_rate=0.2).to(DEVICE)
print('student params (M):', round(sum(p.numel() for p in student.parameters()) / 1e6, 2))
head = [p for n, p in student.named_parameters() if n.startswith('classifier')]
body = [p for n, p in student.named_parameters() if not n.startswith('classifier')]
EPOCHS = 24
opt = torch.optim.AdamW([{'params': body, 'lr': 4e-4}, {'params': head, 'lr': 2e-3}], weight_decay=0.03)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[4e-4, 2e-3], total_steps=EPOCHS * len(dl_tr), pct_start=0.1)
best, hist = 0, []
for ep in range(EPOCHS):
    student.train(); tl = 0
    for x, y, s in dl_tr:
        x, y, s = x.to(DEVICE), y.to(DEVICE), s.to(DEVICE)
        out = student(x)
        ce = F.cross_entropy(out, y, weight=cw, label_smoothing=0.05)
        kd = F.kl_div(F.log_softmax(out / TEMP, -1), F.softmax(s / TEMP, -1), reduction='batchmean') * TEMP * TEMP
        loss = (1 - ALPHA) * ce + ALPHA * kd
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tl += loss.item()
    acc, agree, _, _ = evaluate(dl_va); hist.append((ep, tl / len(dl_tr), acc, agree))
    print(f'epoch {ep + 1:2d}  loss {tl / len(dl_tr):.3f}  val acc {acc:.3f}')
    if acc > best: best = acc; torch.save(student.state_dict(), f'{OUT}/student_best.pt')
student.load_state_dict(torch.load(f'{OUT}/student_best.pt'))
print('best val acc', round(best, 3))
