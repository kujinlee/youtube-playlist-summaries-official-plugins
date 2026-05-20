/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

describe('Header', () => {
  const defaultFolder = '/default/output';

  it('renders playlist URL input, output folder input, and submit button', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    expect(screen.getByPlaceholderText(/playlist url/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/output folder/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(defaultFolder)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeInTheDocument();
  });

  it('button is disabled when URL input is empty', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeDisabled();
  });

  it('button is disabled when URL input is only whitespace', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeDisabled();
  });

  it('button is enabled when URL input has content', () => {
    render(<Header defaultOutputFolder={defaultFolder} onIngest={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    expect(screen.getByRole('button', { name: /fetch & summarize/i })).toBeEnabled();
  });

  it('calls onIngest with correct url and folder on submit', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', defaultFolder);
  });

  it('trims leading/trailing whitespace from URL before calling onIngest', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: '  https://youtube.com/playlist?list=abc  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', defaultFolder);
  });

  it('calls onIngest with updated output folder when user changes it', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), {
      target: { value: 'https://youtube.com/playlist?list=abc' },
    });
    fireEvent.change(screen.getByDisplayValue(defaultFolder), {
      target: { value: '/custom/path' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).toHaveBeenCalledWith('https://youtube.com/playlist?list=abc', '/custom/path');
  });

  it('does not call onIngest when button is disabled', () => {
    const onIngest = jest.fn();
    render(<Header defaultOutputFolder={defaultFolder} onIngest={onIngest} />);
    fireEvent.click(screen.getByRole('button', { name: /fetch & summarize/i }));
    expect(onIngest).not.toHaveBeenCalled();
  });

  it('output folder defaults to defaultOutputFolder prop', () => {
    render(<Header defaultOutputFolder="/my/vault" onIngest={jest.fn()} />);
    expect(screen.getByDisplayValue('/my/vault')).toBeInTheDocument();
  });
});
