import React from 'react';

export type LogoVariant =
  | 'tile-light'
  | 'tile-dark'
  | 'symbol-color'
  | 'symbol-dark'
  | 'symbol-small'
  | 'horizontal-color'
  | 'horizontal-dark';

interface RheowLogoProps extends React.SVGProps<SVGSVGElement> {
  variant?: LogoVariant;
  className?: string;
  title?: string;
}

/**
 * Official Rheow Brand Logo component.
 * Default is 'tile-light' (rheow-app-tile-light.svg) - the primary app logo.
 */
export const RheowLogo: React.FC<RheowLogoProps> = ({
  variant = 'tile-light',
  className = 'w-7 h-7',
  title = 'Rheow',
  ...props
}) => {
  switch (variant) {
    case 'tile-light':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 256 256"
          role="img"
          aria-label={title}
          className={`overflow-visible rheow-logo-tile ${className}`}
          {...props}
        >
          <title>{title}</title>
          <rect
            x="4"
            y="4"
            width="248"
            height="248"
            rx="52"
            fill="#ffffff"
            stroke="rgba(0, 0, 0, 0.13)"
            strokeWidth="7"
          />
          <g transform="translate(18, 18) scale(0.859375)">
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="#2563eb" strokeWidth="28" d="M 102 48 L 168 114" />
              <path stroke="#0a0a0a" strokeWidth="28" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
              <path stroke="#0a0a0a" strokeWidth="28" d="M 52 154 L 82 184" />
            </g>
          </g>
        </svg>
      );

    case 'tile-dark':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 256 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <rect width="256" height="256" rx="54" fill="#0a0a0a" />
          <g transform="translate(18, 18) scale(0.859375)">
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="#3b82f6" strokeWidth="28" d="M 102 48 L 168 114" />
              <path stroke="#ffffff" strokeWidth="28" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
              <path stroke="#ffffff" strokeWidth="28" d="M 52 154 L 82 184" />
            </g>
          </g>
        </svg>
      );

    case 'symbol-color':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 256 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <g fill="none" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round">
            <path stroke="#2563eb" d="M 102 48 L 168 114" />
            <path stroke="#0a0a0a" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
            <path stroke="#0a0a0a" d="M 52 154 L 82 184" />
          </g>
        </svg>
      );

    case 'symbol-dark':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 256 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path stroke="#3b82f6" strokeWidth="24" d="M 102 48 L 168 114" />
            <path stroke="#ffffff" strokeWidth="24" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
            <path stroke="#ffffff" strokeWidth="24" d="M 52 154 L 82 184" />
          </g>
        </svg>
      );

    case 'symbol-small':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 256 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <g fill="none" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
            <path stroke="#2563eb" d="M 104 46 L 170 112" />
            <path stroke="#0a0a0a" d="M 50 96 L 126 172 A 26 26 0 0 0 144 180 L 206 180" />
            <path stroke="#0a0a0a" d="M 50 156 L 80 186" />
          </g>
        </svg>
      );

    case 'horizontal-color':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 780 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <g transform="translate(30, 28) scale(0.78125)">
            <g fill="none" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="#2563eb" d="M 102 48 L 168 114" />
              <path stroke="#0a0a0a" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
              <path stroke="#0a0a0a" d="M 52 154 L 82 184" />
            </g>
          </g>
          {/* R */}
          <path fill="#0a0a0a" d="M 280 84 L 328 84 C 348 84 362 96 362 114 C 362 128 352 139 338 142 L 366 186 L 344 186 L 319 146 L 298 146 L 298 186 L 280 186 Z M 298 100 L 298 131 L 325 131 C 336 131 343 124 343 115 C 343 107 336 100 325 100 Z" />
          {/* h */}
          <path fill="#0a0a0a" d="M 380 72 L 398 72 L 398 120 C 403 113 412 108 422 108 C 438 108 447 118 447 134 L 447 186 L 429 186 L 429 137 C 429 127 423 122 414 122 C 405 122 398 129 398 139 L 398 186 L 380 186 Z" />
          {/* e */}
          <path fill="#0a0a0a" d="M 464 148 C 464 125 480 108 503 108 C 525 108 539 124 539 148 L 482 148 C 483 162 492 172 506 172 C 516 172 524 167 528 158 L 544 163 C 538 178 523 188 505 188 C 481 188 464 171 464 148 Z M 522 135 C 521 124 513 118 503 118 C 492 118 484 124 482 135 Z" />
          {/* o */}
          <path fill="#0a0a0a" d="M 554 148 C 554 125 572 108 595 108 C 618 108 636 125 636 148 C 636 171 618 188 595 188 C 572 188 554 171 554 148 Z M 617 148 C 617 133 607 122 595 122 C 583 122 573 133 573 148 C 573 163 583 174 595 174 C 607 174 617 163 617 148 Z" />
          {/* w */}
          <path fill="#0a0a0a" d="M 648 110 L 666 110 L 678 160 L 691 110 L 707 110 L 720 160 L 732 110 L 750 110 L 730 186 L 712 186 L 699 135 L 686 186 L 668 186 Z" />
        </svg>
      );

    case 'horizontal-dark':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 780 256"
          role="img"
          aria-label={title}
          className={className}
          {...props}
        >
          <title>{title}</title>
          <g transform="translate(30, 28) scale(0.78125)">
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="#3b82f6" strokeWidth="24" d="M 102 48 L 168 114" />
              <path stroke="#ffffff" strokeWidth="24" d="M 52 98 L 126 172 A 26 26 0 0 0 144 180 L 204 180" />
              <path stroke="#ffffff" strokeWidth="24" d="M 52 154 L 82 184" />
            </g>
          </g>
          {/* R */}
          <path fill="#ffffff" d="M 280 84 L 328 84 C 348 84 362 96 362 114 C 362 128 352 139 338 142 L 366 186 L 344 186 L 319 146 L 298 146 L 298 186 L 280 186 Z M 298 100 L 298 131 L 325 131 C 336 131 343 124 343 115 C 343 107 336 100 325 100 Z" />
          {/* h */}
          <path fill="#ffffff" d="M 380 72 L 398 72 L 398 120 C 403 113 412 108 422 108 C 438 108 447 118 447 134 L 447 186 L 429 186 L 429 137 C 429 127 423 122 414 122 C 405 122 398 129 398 139 L 398 186 L 380 186 Z" />
          {/* e */}
          <path fill="#ffffff" d="M 464 148 C 464 125 480 108 503 108 C 525 108 539 124 539 148 L 482 148 C 483 162 492 172 506 172 C 516 172 524 167 528 158 L 544 163 C 538 178 523 188 505 188 C 481 188 464 171 464 148 Z M 522 135 C 521 124 513 118 503 118 C 492 118 484 124 482 135 Z" />
          {/* o */}
          <path fill="#ffffff" d="M 554 148 C 554 125 572 108 595 108 C 618 108 636 125 636 148 C 636 171 618 188 595 188 C 572 188 554 171 554 148 Z M 617 148 C 617 133 607 122 595 122 C 583 122 573 133 573 148 C 573 163 583 174 595 174 C 607 174 617 163 617 148 Z" />
          {/* w */}
          <path fill="#ffffff" d="M 648 110 L 666 110 L 678 160 L 691 110 L 707 110 L 720 160 L 732 110 L 750 110 L 730 186 L 712 186 L 699 135 L 686 186 L 668 186 Z" />
        </svg>
      );
  }
};
