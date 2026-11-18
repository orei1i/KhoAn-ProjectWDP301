import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDays, isClosedContract, ISSUE_TICKET_CATEGORIES, OPEN_CONTRACT_STATUSES, TICKET_CATEGORY, todayISO, TicketCategory } from '@ssm/shared';
import { facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, Field, Input, Screen, ScreenHeader } from '../../shared/ui';

const CATEGORY_OPTIONS = ISSUE_TICKET_CATEGORIES.map((k) => ({ value: k, label: TICKET_CATEGORY[k] }));
// Góp ý 18/11: khách không chọn mức ưu tiên — quản lý chi nhánh đặt mức khi giao việc (phiếu khách gửi luôn bắt đầu ở "Trung bình").
// Server đòi tiêu đề tối thiểu 5 ký tự (BE tickets.routes.ts: subject min(5)) — kiểm trước khi gửi để khách không nhận lỗi "subject".
// Khi @ssm/shared có hằng dùng chung cho luật này thì đổi sang hằng đó.
const SUBJECT_MIN = 5;

export default function TicketNewScreen() {
  const { contract } = useLocalSearchParams<{ contract?: string }>();
  const { db, user, run, busy } = useStore();
  const router = useRouter();
  // Góp ý 17/11: bấm "Gửi yêu cầu" hai lần từng tạo hai phiếu giống hệt. Khoá nút ngay lần bấm đầu (ref — không chờ render lại) tới khi
  // server trả lời; server cũng trả lại phiếu cũ nếu nhận trùng trong 60 giây.
  const sending = useRef(false);
  const [pending, setPending] = useState(false);

  // Hợp đồng đang thuê, vừa đóng trong 30 ngày (khiếu nại biên bản trả kho…), hoặc đã đóng mà còn nợ (thắc mắc khoản nợ).
  const contracts = user ? db.contracts.filter((c) => c.customerId === user._id && (OPEN_CONTRACT_STATUSES.includes(c.status)
    || (isClosedContract(c.status) && ((c.closedAt ?? '') >= addDays(todayISO(), -30) || c.balance.outstanding > 0)))) : [];
  const [contractId, setContractId] = useState(contract && contracts.some((c) => c._id === contract) ? contract : (contracts[0]?._id ?? ''));
  const [category, setCategory] = useState<TicketCategory>('MAINTENANCE');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  if (contracts.length === 0) {
    return (
      <Screen>
        <ScreenHeader icon="construct-outline" tone="blue" title="Báo sự cố / yêu cầu hỗ trợ" />
        <EmptyState
          icon="cube-outline"
          title="Bạn chưa thuê kho nào"
          description="Cần có hợp đồng đang hiệu lực mới gửi được yêu cầu hỗ trợ."
        />
      </Screen>
    );
  }

  const c = contracts.find((x) => x._id === contractId) ?? contracts[0];
  const canSend = subject.trim().length >= SUBJECT_MIN && description.trim().length > 0;

  return (
    <Screen footer={(
      <Button
        title="Gửi yêu cầu"
        icon="send"
        size="lg"
        disabled={!canSend || busy}
        loading={pending}
        onPress={async () => {
          if (sending.current || !canSend) return;
          sending.current = true;
          setPending(true);
          const res = await run(
            'createTicket',
            // Chỉ gắn ô kho khi hợp đồng còn mở — BE chỉ nhận ô của hợp đồng đang thuê (ô của hợp đồng đã đóng có thể đã cho người khác thuê).
            { facilityId: c.facilityId, category, subject: subject.trim(), description: description.trim(), unitId: OPEN_CONTRACT_STATUSES.includes(c.status) ? c.unitId : undefined, contractId: c._id },
            (t) => `Đã gửi yêu cầu ${t.ticketNumber}`,
            (t) => router.replace({ pathname: '/ticket/[id]', params: { id: t._id, created: '1' } }),
          );
          // Thành công thì màn này đã được thay bằng phiếu vừa tạo; lỗi thì mở lại nút để khách sửa và gửi lại.
          if (!res.ok) { sending.current = false; setPending(false); }
        }}
      />
    )}>
      <ScreenHeader icon="construct-outline" tone="blue" title="Báo sự cố / yêu cầu hỗ trợ" subtitle="Chi nhánh sẽ phản hồi trong mục Hỗ trợ." />
      <Card>
        <Field label="Hợp đồng">
          <Chips
            options={contracts.map((x) => ({ value: x._id, label: `${unitLabel(db, x.unitId)} · ${facilityName(db, x.facilityId)}` }))}
            value={c._id}
            onChange={setContractId}
          />
        </Field>
        <Field label="Loại sự cố">
          <Chips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        </Field>
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Field label="Tiêu đề" tip={`Tối thiểu ${SUBJECT_MIN} ký tự.`}>
          <Input value={subject} onChangeText={setSubject} placeholder="Ví dụ: Khoá kho bị kẹt" />
        </Field>
        <Field label="Mô tả">
          <Input
            value={description} onChangeText={setDescription} placeholder="Mô tả chi tiết sự cố"
            multiline numberOfLines={4}
          />
        </Field>
      </Card>
    </Screen>
  );
}
