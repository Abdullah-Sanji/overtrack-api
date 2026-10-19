import { Module } from '@nestjs/common';
import { UsersModule } from '@/users/users.module';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationsController } from './notifications.controller';
import { ReminderService } from './reminder.service';
@Module({ imports: [UsersModule], controllers: [NotificationsController], providers: [NotificationsService, NotificationsListener, ReminderService], exports: [NotificationsService] })
export class NotificationsModule {}
