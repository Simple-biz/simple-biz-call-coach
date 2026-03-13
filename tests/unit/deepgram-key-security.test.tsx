import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Login from '@/popup/Login';

// Known hardcoded keys that must never appear in source
const KNOWN_HARDCODED_KEYS = [
  'e06e624c52e5974a4e5162b3c93306ecdda52bc9',
];

describe('Deepgram API Key Security', () => {
  describe('Login component', () => {
    let mockOnLogin: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnLogin = vi.fn();
    });

    it('should render a Deepgram API key input field', () => {
      render(<Login onLogin={mockOnLogin} />);
      const keyInput = screen.getByPlaceholderText(/deepgram api key/i);
      expect(keyInput).toBeInTheDocument();
      expect(keyInput).toHaveAttribute('type', 'password');
    });

    it('should not submit if Deepgram key is empty', () => {
      render(<Login onLogin={mockOnLogin} />);

      const emailInput = screen.getByPlaceholderText('you@company.com');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      const button = screen.getByRole('button', { name: /continue/i });
      fireEvent.click(button);

      expect(mockOnLogin).not.toHaveBeenCalled();
    });

    it('should pass Deepgram key to onLogin when provided', async () => {
      render(<Login onLogin={mockOnLogin} />);

      const emailInput = screen.getByPlaceholderText('you@company.com');
      const keyInput = screen.getByPlaceholderText(/deepgram api key/i);

      fireEvent.change(emailInput, { target: { value: 'agent@company.com' } });
      fireEvent.change(keyInput, { target: { value: 'user-provided-key-123' } });

      const button = screen.getByRole('button', { name: /continue/i });
      fireEvent.click(button);

      // onLogin is called after a 500ms setTimeout
      await vi.waitFor(() => {
        expect(mockOnLogin).toHaveBeenCalledWith(
          'agent@company.com',
          undefined,
          'user-provided-key-123'
        );
      });
    });

    it('should disable submit button when Deepgram key is missing', () => {
      render(<Login onLogin={mockOnLogin} />);

      const emailInput = screen.getByPlaceholderText('you@company.com');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      const button = screen.getByRole('button', { name: /continue/i });
      expect(button).toBeDisabled();
    });

    it('should enable submit button when both email and Deepgram key are filled', () => {
      render(<Login onLogin={mockOnLogin} />);

      const emailInput = screen.getByPlaceholderText('you@company.com');
      const keyInput = screen.getByPlaceholderText(/deepgram api key/i);

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(keyInput, { target: { value: 'my-key' } });

      const button = screen.getByRole('button', { name: /continue/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('No hardcoded keys in source files', () => {
    it('should not contain known hardcoded Deepgram keys in Popup.tsx', async () => {
      // Read the actual source file content
      const { default: fs } = await import('fs');
      const popupSource = fs.readFileSync('src/popup/Popup.tsx', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(popupSource).not.toContain(key);
      }
    });

    it('should not contain known hardcoded Deepgram keys in SidePanel.tsx', async () => {
      const { default: fs } = await import('fs');
      const sidePanelSource = fs.readFileSync('src/sidepanel/SidePanel.tsx', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(sidePanelSource).not.toContain(key);
      }
    });

    it('should not contain known hardcoded Deepgram keys in background/index.ts', async () => {
      const { default: fs } = await import('fs');
      const bgSource = fs.readFileSync('src/background/index.ts', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(bgSource).not.toContain(key);
      }
    });
  });
});
