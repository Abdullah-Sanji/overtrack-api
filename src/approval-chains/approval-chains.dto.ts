import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '@/common/zod';

export class ReplaceChainDto extends createZodDto(z.object({
  steps: z.array(z.object({ label: z.string().min(1).max(40), approverId: zUuid, backupApproverId: zUuid.nullable().optional() })).max(10),
})) {}
