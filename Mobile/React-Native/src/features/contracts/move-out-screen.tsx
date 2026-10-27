import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDays, contractClawback, earlyTerminationPreviewOf, exitCommitment, fmtDate, handoverDeadline, MAX_MOVE_OUT_LEAD_DAYS, todayISO, vnd,
} from '@ssm/shared';
import { byId, effectivePolicy, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, DateStepper, EmptyState, Muted, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

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
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);

  return (
    <Screen>
      <ScreenHeader title={c.status === 'ACTIVE' ? 'Đăng ký trả kho' : 'Trả kho'} subtitle={`Hợp đồng ${c.contractNumber} · Kho ${unitLabel(db, c.unitId)}`} />

      {c.status === 'ACTIVE' ? (
        <Card>
          <Text style={[st.hint, { marginTop: 0 }]}>
            Tiền thuê và mức hoàn tiền giữ chân tính theo ngày bạn THỰC TẾ bàn giao kho, không theo ngày hẹn. Tiền giữ chân hoàn sau khi trừ chi phí hư hại (nếu có).
            {(exitCommitment(c, rsv?.quote, todayISO())?.discountAmount ?? 0) > 0 ? '' : ' Trả kho trước hạn vẫn được hoàn đủ tiền giữ chân.'}
          </Text>
          <DateStepper label="Ngày trả kho dự kiến" value={moveOutDate} onChange={setMoveOutDate} min={todayISO()} max={addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS)} />
          {/* Mốc 00:00 ngày thu kỳ kế tiếp là lúc phát sinh tiền thuê kỳ mới — bàn giao trước mốc này thì không bị tính thêm kỳ. */}
          <Text style={[st.hint, moveOutDate > handoverDeadline(c) ? { color: C.amber } : null]}>
            Bàn giao kho trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh tiền thuê kỳ mới
            {moveOutDate > handoverDeadline(c) ? ` — ngày hẹn này sau mốc đó nên kỳ thuê bắt đầu ${fmtDate(c.billing.nextBillingDate)} vẫn được tính tiền.` : '.'} Hẹn trước tối đa {MAX_MOVE_OUT_LEAD_DAYS} ngày.
          </Text>
          {(() => {
            // Xem trước trần % hoàn tiền giữ chân và phần thu hồi ưu đãi thuê dài hạn nếu bàn giao đúng ngày đang chọn — cùng công thức
            // với server (shared), bảng mức hoàn theo chính sách đã chốt lúc cam kết, như web.
            const preview = earlyTerminationPreviewOf(c, rsv?.quote, db.policies, effectivePolicy(db, c.facilityId), moveOutDate);
            const claw = contractClawback(c, rsv?.quote, db.policies, moveOutDate);
            if (!preview && !claw) return null;
            const none = preview?.refundCapPct === 0;
            return (
              <View style={[st.box, { backgroundColor: none ? C.redBg : C.amberBg }]}>
                {preview && (
                  <Text style={[st.boxText, { color: none ? C.red : C.amber }]}>
                    Trả kho sớm — nếu bàn giao đúng ngày này thì bạn đã dùng {preview.elapsedPct}% kỳ hạn thuê, tiền giữ chân được hoàn tối đa{' '}
                    <Text style={{ fontWeight: '800' }}>{preview.refundCapPct}%</Text>{none ? ' (không hoàn tiền giữ chân)' : ''}, chưa kể trừ chi phí hư hại nếu có.
                  </Text>
                )}
                {claw && (
                  <Text style={[st.boxText, { color: C.amber, marginTop: preview ? 6 : 0 }]}>
                    Thu hồi ưu đãi: bạn mới dùng {claw.usedPeriods} tháng nên chỉ được giảm {vnd(claw.entitledPerPeriod)}/tháng thay vì {vnd(claw.discountPerPeriod)}/tháng — phần đã hưởng vượt {vnd(claw.amount)} sẽ trừ vào tiền giữ chân được hoàn.
                  </Text>
                )}
              </View>
            );
          })()}
          <Button
            title="Đăng ký trả kho"
            style={{ marginTop: S.md }}
            onPress={() => void run('requestMoveOut', { contractId: c._id, date: moveOutDate }, 'Đã đăng ký trả kho', backToContract)}
          />
        </Card>
      ) : c.status === 'MOVE_OUT_PENDING' ? (
        <Card>
          <Badge tone="violet">{c.access.revokedAt ? 'Đã bàn giao — chờ kiểm tra' : `Hẹn trả kho ${fmtDate(c.moveOut?.scheduledFor)}`}</Badge>
          {!c.access.revokedAt && (
            <>
              <Text style={st.hint}>Bàn giao kho trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh tiền thuê kỳ mới.</Text>
              <Button
                title="Rút đăng ký trả kho" variant="secondary"
                onPress={() => void run('cancelMoveOut', { contractId: c._id }, 'Đã rút đăng ký trả kho — hợp đồng tiếp tục hiệu lực', backToContract)}
              />
            </>
          )}
        </Card>
      ) : <Card><Muted>Chỉ đăng ký trả kho được khi hợp đồng đang hiệu lực.</Muted></Card>}
    </Screen>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: S.md },
  box: { borderRadius: 12, padding: S.md, marginBottom: S.sm },
  boxText: { fontSize: 13, lineHeight: 19 },
});
