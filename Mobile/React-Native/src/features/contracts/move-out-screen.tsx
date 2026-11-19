import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDays, contractClawback, earlyTerminationPreviewOf, exitCommitment, fmtDate, handoverDeadline, MAX_MOVE_OUT_LEAD_DAYS, MOVE_OUT_STAGE, moveOutStageOf, todayISO, vnd,
  expiryLockFrom, lastDayOf, usesGraceHold,
} from '@ssm/shared';
import { byId, effectivePolicy, unitLabel, useStore } from '../../shared/store/store';
import { Button, Callout, Card, Chip, DateStepper, Disclosure, EmptyState, IconTile, Screen, ScreenHeader } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, S, T } from '../../shared/ui/theme';

/** Trả kho: hợp đồng đang hiệu lực thì hẹn ngày bàn giao; đã đăng ký thì xem lịch hẹn và rút đăng ký (khi chưa bàn giao). */
export default function MoveOutScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [moveOutDate, setMoveOutDate] = useState(addDays(todayISO(), 3));

  const c = byId(db.contracts, contract);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const rsv = byId(db.reservations, c.reservationId) ?? db.reservations.find((x) => x.contractId === c._id);
  // Đợt 17: bước của lượt trả kho — đã bàn giao thì chi nhánh kiểm ô, quản lý duyệt biên bản, rồi bạn xác nhận bằng mã OTP tại quầy.
  const report = db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT');
  const stage = moveOutStageOf(c, report);
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);
  // Điều khoản 1.24: hợp đồng có quy tắc hết hạn — hẹn bàn giao TRƯỚC ngày khoá (server: 422 MOVE_OUT_AFTER_GRACE); không còn "kỳ mới".
  const graceHold = usesGraceHold(c);
  const far = addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS);
  const lockLast = graceHold ? addDays(expiryLockFrom(c), -1) : far;
  const maxDate = lockLast < far ? lockLast : far;
  const date = moveOutDate > maxDate ? maxDate : moveOutDate;
  const late = !graceHold && date > handoverDeadline(c);

  return (
    <Screen footer={c.status === 'ACTIVE' ? (
      <Button
        title="Đăng ký trả kho"
        icon="exit-outline"
        size="lg"
        onPress={() => void run('requestMoveOut', { contractId: c._id, date }, 'Đã đăng ký trả kho', backToContract)}
      />
    ) : undefined}>
      <ScreenHeader icon="exit-outline" tone="violet" title={c.status === 'ACTIVE' ? 'Đăng ký trả kho' : 'Trả kho'} subtitle={`Hợp đồng ${c.contractNumber} · Kho ${unitLabel(db, c.unitId)}`} />

      {c.status === 'ACTIVE' ? (
        <>
          <Card>
            <DateStepper label="Ngày trả kho dự kiến" value={date} onChange={setMoveOutDate} min={todayISO()} max={maxDate} />
            {/* Mốc 00:00 ngày thu kỳ kế tiếp là lúc phát sinh tiền thuê kỳ mới — bàn giao trước mốc này thì không bị tính thêm kỳ. */}
            <View style={[st.deadline, late && { backgroundColor: C.amberBg, borderColor: C.amberLine }]}>
              <IconTile icon="alarm-outline" tone={late ? 'amber' : 'teal'} size="sm" />
              {graceHold ? (
                <Text style={st.deadlineText}>
                  Hết thời hạn (hết ngày {fmtDate(lastDayOf(c.endDate))}) không tính thêm tiền thuê. Bàn giao sau ngày đó thì phí lưu giữ {vnd(c.expiry?.dailyFee ?? 0)}/ngày tính tới ngày bàn giao (trừ vào tiền giữ chân).
                  Hẹn bàn giao trước ngày {fmtDate(expiryLockFrom(c))} — từ ngày đó quyền ra vào bị khoá.
                </Text>
              ) : (
                <Text style={[st.deadlineText, late && { color: C.amberInk }]}>
                  Bàn giao kho trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh tiền thuê kỳ mới
                  {late ? ` — ngày hẹn này sau mốc đó nên kỳ thuê bắt đầu ${fmtDate(c.billing.nextBillingDate)} vẫn được tính tiền.` : '.'} Hẹn trước tối đa {MAX_MOVE_OUT_LEAD_DAYS} ngày.
                </Text>
              )}
            </View>
          </Card>

          {(() => {
            // Xem trước trần % hoàn tiền giữ chân và phần thu hồi ưu đãi thuê dài hạn nếu bàn giao đúng ngày đang chọn — cùng công thức
            // với server (shared), bảng mức hoàn theo chính sách đã chốt lúc cam kết, như web.
            const preview = earlyTerminationPreviewOf(c, rsv?.quote, db.policies, effectivePolicy(db, c.facilityId), date);
            const claw = contractClawback(c, rsv?.quote, db.policies, date);
            if (!preview && !claw) return null;
            const none = preview?.refundCapPct === 0;
            return (
              <Callout tone={none ? 'red' : 'amber'} icon="cash-outline" style={{ marginTop: S.md }}>
                {preview && (
                  <Text>
                    Trả kho sớm — nếu bàn giao đúng ngày này thì bạn đã dùng {preview.elapsedPct}% kỳ hạn thuê, tiền giữ chân được hoàn tối đa{' '}
                    <Text style={{ fontWeight: '800' }}>{preview.refundCapPct}%</Text>{none ? ' (không hoàn tiền giữ chân)' : ''}, chưa kể trừ chi phí hư hại nếu có.
                  </Text>
                )}
                {preview && claw ? '\n\n' : null}
                {claw && (
                  <Text>
                    Thu hồi ưu đãi: bạn mới dùng {claw.usedPeriods} tháng nên chỉ được giảm {vnd(claw.entitledPerPeriod)}/tháng thay vì {vnd(claw.discountPerPeriod)}/tháng — phần đã hưởng vượt {vnd(claw.amount)} sẽ trừ vào tiền giữ chân được hoàn.
                  </Text>
                )}
              </Callout>
            );
          })()}

          <Card style={{ marginTop: S.md }}>
            <Disclosure title="Tiền thuê và tiền giữ chân tính thế nào?" icon="help-circle-outline">
              Tiền thuê và mức hoàn tiền giữ chân tính theo ngày bạn THỰC TẾ bàn giao kho, không theo ngày hẹn. Tiền giữ chân hoàn sau khi trừ chi phí hư hại (nếu có).
              {(exitCommitment(c, rsv?.quote, todayISO())?.discountAmount ?? 0) > 0 ? '' : ' Trả kho trước hạn vẫn được hoàn đủ tiền giữ chân.'}
            </Disclosure>
          </Card>
        </>
      ) : c.status === 'MOVE_OUT_PENDING' ? (
        <Card>
          <View style={st.pendingHead}>
            <IconTile icon={stage === 'AWAITING_CONFIRMATION' ? 'mail-unread-outline' : c.access.revokedAt ? 'hourglass-outline' : 'calendar-outline'} tone={stage === 'AWAITING_CONFIRMATION' ? 'green' : 'violet'} size="lg" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={T.h3}>{c.access.revokedAt ? 'Đã bàn giao kho' : 'Đã đăng ký trả kho'}</Text>
              <Chip tone={stage === 'AWAITING_CONFIRMATION' ? 'green' : 'violet'} dot>{c.access.revokedAt && stage ? MOVE_OUT_STAGE[stage].customer : `Hẹn trả kho ${fmtDate(c.moveOut?.scheduledFor)}`}</Chip>
            </View>
          </View>
          {stage === 'AWAITING_CONFIRMATION' && (
            <Text style={st.hint}>Quản lý chi nhánh đã duyệt biên bản trả kho. Xem phí và quyết toán ở màn Hợp đồng, rồi đọc mã OTP gửi về email cho nhân viên tại quầy — hợp đồng chỉ đóng sau khi bạn xác nhận.</Text>
          )}
          {(stage === 'AWAITING_APPROVAL' || stage === 'RETURNED' || stage === 'AWAITING_INSPECTION') && (
            <Text style={st.hint}>Chi nhánh kiểm ô và lập biên bản; quản lý chi nhánh ghi phí (nếu có) và duyệt. Bạn sẽ xem được biên bản ở màn Hợp đồng trước khi xác nhận bằng mã OTP.</Text>
          )}
          {!c.access.revokedAt && (
            <>
              <Text style={st.hint}>Bàn giao kho trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh tiền thuê kỳ mới.</Text>
              <Button
                title="Rút đăng ký trả kho" variant="secondary" icon="arrow-undo-outline"
                onPress={() => confirmAction(
                  'Rút đăng ký trả kho?', `Hợp đồng ${c.contractNumber} tiếp tục hiệu lực và tiếp tục tính tiền thuê.`, 'Rút đăng ký',
                  () => void run('cancelMoveOut', { contractId: c._id }, 'Đã rút đăng ký trả kho — hợp đồng tiếp tục hiệu lực', backToContract),
                )}
              />
            </>
          )}
        </Card>
      ) : <Callout tone="amber" icon="lock-closed-outline">Chỉ đăng ký trả kho được khi hợp đồng đang hiệu lực.</Callout>}
    </Screen>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: S.md, marginBottom: S.md },
  deadline: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md, marginTop: S.md, padding: S.md, borderRadius: 12, backgroundColor: C.brand50, borderWidth: 1, borderColor: C.brand100 },
  deadlineText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.brand900 },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: S.md },
});
