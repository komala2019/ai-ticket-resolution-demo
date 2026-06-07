import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule, Routes } from '@angular/router';

import { AppComponent } from './app.component';

// The demo IS the ticket-resolution module. It's lazy-loaded so its own
// internal route (path '') renders the shell component.
const routes: Routes = [
  {
    path: '',
    loadChildren: () =>
      import('./ticket-resolution/ticket-resolution.module').then(m => m.TicketResolutionModule),
  },
  { path: '**', redirectTo: '' },
];

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    RouterModule.forRoot(routes, { useHash: false }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
