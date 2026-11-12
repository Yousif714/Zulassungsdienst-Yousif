import { DemoBadge } from '@/components/DemoBadge';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';

export default function HeutePage() {
  return <PageHeader title="Heute" badge={<DemoBadge />} trailing={<MoreMenu />} />;
}
