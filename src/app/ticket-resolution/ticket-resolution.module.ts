import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { TicketResolutionComponent } from './ticket-resolution.component';
import { CustomerChatComponent } from './customer-chat/customer-chat.component';
import { ConfidenceGaugeComponent } from './shared/confidence-gauge/confidence-gauge.component';
import { ThresholdBarComponent } from './shared/threshold-bar/threshold-bar.component';
import { TypeChipComponent, RouteChipComponent, PriorityChipComponent } from './shared/chips/chips.component';
import { ApprovalQueueComponent } from './cs-console/approval-queue/approval-queue.component';
import { TicketDetailComponent } from './cs-console/ticket-detail/ticket-detail.component';
import { EscalateModalComponent } from './cs-console/escalate-modal/escalate-modal.component';
import { KbManagerComponent } from './cs-console/kb-manager/kb-manager.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { ReadmeComponent } from './readme/readme.component';
import { ArchitectureComponent } from './architecture/architecture.component';
import { GoldenComponent } from './golden/golden.component';
import { MarkdownPipe } from './markdown.pipe';
import { PresentationComponent } from './presentation/presentation.component';

const routes: Routes = [{ path: '', component: TicketResolutionComponent }];

@NgModule({
  declarations: [
    TicketResolutionComponent,
    CustomerChatComponent,
    ConfidenceGaugeComponent,
    ThresholdBarComponent,
    TypeChipComponent,
    RouteChipComponent,
    PriorityChipComponent,
    ApprovalQueueComponent,
    TicketDetailComponent,
    EscalateModalComponent,
    KbManagerComponent,
    AnalyticsComponent,
    ReadmeComponent,
    ArchitectureComponent,
    GoldenComponent,
    MarkdownPipe,
    PresentationComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
  ],
})
export class TicketResolutionModule {}
