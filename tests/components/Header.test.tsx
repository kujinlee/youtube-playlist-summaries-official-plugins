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

describe('Header — Sync button', () => {
  it('does not render Sync button when onSync is not provided', () => {
    render(<Header defaultOutputFolder="/folder" onIngest={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
  });

  it('renders Sync button when onSync is provided and syncEnabled=true', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        syncEnabled={true}
      />,
    );
    expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument();
  });

  it('Sync button is enabled when syncEnabled=true and not disabled', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        syncEnabled={true}
      />,
    );
    expect(screen.getByRole('button', { name: /sync/i })).toBeEnabled();
  });

  it('Sync button is disabled when global disabled=true', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        syncEnabled={true}
        disabled={true}
      />,
    );
    expect(screen.getByRole('button', { name: /sync/i })).toBeDisabled();
  });

  it('Sync button is disabled when syncEnabled=false', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        syncEnabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /sync/i })).toBeDisabled();
  });

  it('calls onSync with current output folder when Sync button is clicked', () => {
    const onSync = jest.fn();
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={onSync}
        syncEnabled={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledWith('/folder');
  });

  it('calls onSync with updated folder when user has changed the folder input', () => {
    const onSync = jest.fn();
    render(
      <Header
        defaultOutputFolder="/original"
        onIngest={jest.fn()}
        onSync={onSync}
        syncEnabled={true}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('/original'), { target: { value: '/new-folder' } });
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledWith('/new-folder');
  });

  it('Sync button has disabled attribute when syncEnabled=false (prevents click)', () => {
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={jest.fn()}
        onSync={jest.fn()}
        syncEnabled={false}
      />,
    );
    // asserting disabled is the correct way to verify the button cannot be activated;
    // fireEvent.click on a disabled button has ambiguous behavior across JSDOM versions.
    expect(screen.getByRole('button', { name: /sync/i })).toBeDisabled();
  });

  it('Sync button click does not trigger form submission (no URL input required)', () => {
    const onIngest = jest.fn();
    const onSync = jest.fn();
    render(
      <Header
        defaultOutputFolder="/folder"
        onIngest={onIngest}
        onSync={onSync}
        syncEnabled={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sync/i }));
    expect(onIngest).not.toHaveBeenCalled();
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});
