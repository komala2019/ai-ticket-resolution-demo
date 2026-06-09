import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { DemoStateService } from '../demo-state.service';
import { TYPE_META, ROUTE_META, RouteKey, Thresholds, routeFor } from '../ticket-data';

interface Slide {
  id: number;
  title: string;
  subtitle: string;
}

@Component({
  selector: 'app-tr-presentation',
  templateUrl: './presentation.component.html',
  styleUrls: ['./presentation.component.scss']
})
export class PresentationComponent implements OnInit, OnDestroy {
  currentSlide = 0;
  totalSlides = 9;
  isFullscreen = false;

  TYPE_META = TYPE_META;
  ROUTE_META = ROUTE_META;

  // Local copy of thresholds to play with on Slide 6
  thresholds: Thresholds = { auto: 90, approve: 70, rewrite: 40 };

  constructor(public demo: DemoStateService) {}

  ngOnInit() {
    // Initialize thresholds from the demo service
    if (this.demo.queue) {
      // Synchronize with existing shell thresholds if possible
      // (though we can let the presenter tweak them locally here or sync them)
    }

    // Monitor fullscreen changes
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.addEventListener('MSFullscreenChange', this.onFullscreenChange);
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('MSFullscreenChange', this.onFullscreenChange);
  }

  onFullscreenChange = () => {
    this.isFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  };

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    // Only navigate slides if the user is not typing in a text field
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'Space':
        event.preventDefault();
        this.next();
        break;
      case 'ArrowLeft':
      case 'Backspace':
        event.preventDefault();
        this.prev();
        break;
      case 'Home':
        event.preventDefault();
        this.goToSlide(0);
        break;
      case 'End':
        event.preventDefault();
        this.goToSlide(this.totalSlides - 1);
        break;
    }
  }

  next() {
    if (this.currentSlide < this.totalSlides - 1) {
      this.currentSlide++;
    }
  }

  prev() {
    if (this.currentSlide > 0) {
      this.currentSlide--;
    }
  }

  goToSlide(index: number) {
    if (index >= 0 && index < this.totalSlides) {
      this.currentSlide = index;
    }
  }

  toggleFullscreen() {
    const element = document.documentElement;
    if (!this.isFullscreen) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if ((element as any).mozRequestFullScreen) { /* Firefox */
        (element as any).mozRequestFullScreen();
      } else if ((element as any).webkitRequestFullscreen) { /* Chrome, Safari and Opera */
        (element as any).webkitRequestFullscreen();
      } else if ((element as any).msRequestFullscreen) { /* IE/Edge */
        (element as any).msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).mozCancelFullScreen) { /* Firefox */
        (document as any).mozCancelFullScreen();
      } else if ((document as any).webkitExitFullscreen) { /* Chrome, Safari and Opera */
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) { /* IE/Edge */
        (document as any).msExitFullscreen();
      }
    }
  }

  exitPresentation() {
    // Switch back to 'readme' or 'customer' in the main shell
    this.demo.viewState$.next('readme');
  }

  // Helper to get route band count based on presentation thresholds
  getBandCount(band: RouteKey): number {
    return this.demo.queue.filter(t => {
      // If the ticket is already handled, exclude or count it?
      // Let's count unhandled or all based on confidence score distribution
      const routed = routeFor(t.confidence, this.thresholds);
      return routed === band;
    }).length;
  }

  onThresholdChange(key: keyof Thresholds, val: number) {
    const t = { ...this.thresholds, [key]: val };
    if (key === 'auto')    t.auto    = Math.max(val, t.approve + 5);
    if (key === 'approve') { t.approve = Math.max(t.rewrite + 5, Math.min(val, t.auto - 5)); }
    if (key === 'rewrite') t.rewrite = Math.min(val, t.approve - 5);
    t.approve = Math.min(t.approve, t.auto - 5);
    t.rewrite = Math.min(t.rewrite, t.approve - 5);
    this.thresholds = t;

    // Sync back to DemoStateService so thresholds reflect immediately in shell
    this.demo.rehydrateQueue(this.thresholds);
  }

  resetThresholds() {
    this.thresholds = { auto: 90, approve: 75, rewrite: 50 };
    this.demo.rehydrateQueue(this.thresholds);
  }
}
