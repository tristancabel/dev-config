;;; package --- config
;;; Commentary:
;;; packages configurations
;;;

;;; Code:
;; smart-mode-line
;; smart-mode-line -> line model
;; ;;;;;;;;;;;;;;;;;;;;
(use-package smart-mode-line
  :ensure t
  :config
  (setq sml/no-confirm-load-theme t)
  (sml/setup))

;; undo-tree
;; undo and redo functions
;; ;;;;;;;;;;;;;;;;;;;;
(use-package undo-tree
  :ensure t
  :config
  (global-undo-tree-mode)
  (setq undo-tree-visualizer-timestamps t)
  (setq undo-tree-visualizer-diff t)
  (setq undo-tree-auto-save-history nil))

;; whitespace-cleanup-mode
;; whitespace-cleanup-mode is a minor mode which calls whitespace-cleanup before saving the current buffer,
;; by default only if the whitespace in the buffer was initially clean. It determines this by quickly checking
;; to see if whitespace-cleanup would have any effect on the buffer.
;; ;;;;;;;;;;;;;;;;;;;;
(use-package whitespace-cleanup-mode
  :ensure t
  :config
  (global-whitespace-cleanup-mode))


;; browse-kill-ring
;; to be able to browse kill-ring
;; ;;;;;;;;;;;;;;;;;;;;
(use-package browse-kill-ring
  :ensure t
  :bind (("M-y" . brosw-kill-ring)))

;; beacon
;; highlight cursor after window moves
;; ;;;;;;;;;;;;;;;;;;;;
(use-package beacon
  :ensure t
  :config
  (beacon-mode 1))

;; which-key
;; displays the key bindings following your currently entered incomplete command
;; ;;;;;;;;;;;;;;;;;;;;
(use-package which-key
  :ensure t
  :config
  (which-key-mode))

;; json-mode
;; ;;;;;;;;;;;;;;;;;;;;
(use-package json-mode
  :ensure t
  :mode ("\\.json\\'" . json-mode))

(use-package yaml-mode
  :ensure t
  :mode "\\.yml\\'")

;; markdown-mode
;; ;;;;;;;;;;;;;;;;;;;;
(use-package markdown-mode
  :ensure t
  :commands (markdown-mode gfm-mode)
  :mode (("README\\.md\\'" . gfm-mode)
         ("\\.md\\'" . markdown-mode)
         ("\\.markdown\\'" . markdown-mode))
  :init (setq markdown-command "multimarkdown"))

;; find-other-file
;; ;;;;;;;;;;;;;;;;;;;
(global-set-key (kbd "C-c a") 'ff-find-other-file)

;; ediff - don't start another frame
;; ;;;;;;;;;;;;;;;;;;;;
;(require 'ediff)
;(setq ediff-window-setup-function 'ediff-setup-windows-plain)

;; magit
;; ;;;;;;;;;;;;;;;;;;;;
(use-package magit
  :ensure t
  :bind (("C-c v s" . magit-status)
         ("C-c v l" . magit-log)
         ("C-c v v" . magit-blame)
         ("C-c v p" . magit-pull)
         ("C-c v b" . magit-branch-popup))
         )

;; Highlight git lines change
(use-package git-gutter-fringe
  :ensure t
  :config
  (global-git-gutter-mode))


;; icons for sidebar
;; icons
;; ;;;;;;;;;;;;;;;;;;;;
(use-package vscode-icon
  :ensure t
  :commands (vscode-icon-for-file))

;; dired-sidebar
;; sidebar with files arborescence
;; ;;;;;;;;;;;;;;;;;;;;
(use-package dired-sidebar
  :bind (("C-x C-n" . dired-sidebar-toggle-sidebar))
  :ensure t
  :commands (dired-sidebar-toggle-sidebar)
  :init
  (add-hook 'dired-sidebar-mode-hook
            (lambda ()
              (unless (file-remote-p default-directory)
                (auto-revert-mode))))
  :config
  (push 'toggle-window-split dired-sidebar-toggle-hidden-commands)
  (push 'rotate-windows dired-sidebar-toggle-hidden-commands)

  (setq dired-sidebar-subtree-line-prefix "_")
  (setq dired-sidebar-theme 'vscode)
  (setq dired-sidebar-use-term-integration t)
  (setq dired-sidebar-use-custom-font t))

;; counsel/ivy/swipper
;; completion framework
;; ;;;;;;;;;;;;;;;;;;;;
(use-package counsel
  :ensure t
  :bind
  (("M-y" . counsel-yank-pop)
   :map ivy-minibuffer-map
   ("M-y" . ivy-next-line)))

(use-package ivy :demand
             :diminish (ivy-mode)
             :bind (("C-x b" . ivy-switch-buffer))
             :config
             (setq ivy-use-virtual-buffers t
                   ivy-count-format "%d/%d "
                   ivy-display-style 'fancy))


(use-package swiper
  :ensure t
  :bind (("C-s" . swiper-isearch)
     ("C-r" . swiper-isearch)
     ("C-c C-r" . ivy-resume)
     ("M-x" . counsel-M-x)
     ("C-x C-f" . counsel-find-file))
  :config
  (progn
    (ivy-mode 1)
    (setq ivy-use-virtual-buffers t)
    (setq ivy-display-style 'fancy)
    (define-key read-expression-map (kbd "C-r") 'counsel-expression-history)
    ))


;; ;;projectile
;; project interaction library for Emacs.
;; ;; ;;;;;;;;;;;;;;;;;;;;
(use-package projectile
    :ensure t
    :bind (:map projectile-mode-map
                  ("s-p" . 'projectile-command-map)
                  ("C-c p" . 'projectile-command-map)
                )
    :config
    (setq projectile-completion-system 'ivy)
    (add-to-list 'projectile-globally-ignored-directories "build*")
    (add-to-list 'projectile-globally-ignored-directories ".cache")
    (projectile-mode 1)
    (defun projectile-project-find-function (dir)
      (let* ((root (projectile-project-root dir)))
        (and root (cons 'transient root))))
    (with-eval-after-load 'project
      (add-to-list 'project-find-functions 'projectile-project-find-function))
    (projectile-register-project-type 'cmake '("CMakeLists.txt")
                                  :compilation-dir "build"
                                  :configure "cmake %s"
                                  :compile "make -j 6"
                                  :install "make -j 6 install"
                                  :test "make test")
)

;; conda
;; to work with conda environment
;; ;;;;;;;;;;;;;;;;;;;;
(defun my/eglot-reconnect-if-managed ()
  "Reconnect the current Eglot workspace when one is active."
  (when (and (fboundp 'eglot-current-server)
             (fboundp 'eglot-reconnect))
    (let ((server (eglot-current-server)))
      (when server
        (eglot-reconnect server)))))

(defun my/conda_hook ()
  "Reconnect Eglot after switching Conda environments."
  (let ((env-name (conda--infer-env-from-buffer)))
    (when env-name
      (setq-local mode-line-process (concat "(" env-name ")"))
      (my/eglot-reconnect-if-managed)
      (message "Reconnected Eglot for Conda env %s" env-name))))

(use-package conda
  :ensure t
  :init
  (setq conda-anaconda-home (expand-file-name "~/miniconda3"))
  (setq conda-env-home-directory (expand-file-name "~/miniconda3"))
   :config
  (conda-env-initialize-interactive-shells)
  (conda-env-initialize-eshell)
  (conda-env-autoactivate-mode t)

  :hook
  ((conda-postactivate-hook . my/conda_hook)
   (conda-postdeactivate-hook . my/eglot-reconnect-if-managed)))

(add-hook 'python-mode-hook
          #'(lambda ()
              (when (bound-and-true-p conda-project-env-path)
                (conda-env-activate-for-buffer)
                (my/eglot-reconnect-if-managed))))
(add-hook 'python-ts-mode-hook
          #'(lambda ()
              (when (bound-and-true-p conda-project-env-path)
                (conda-env-activate-for-buffer)
                (my/eglot-reconnect-if-managed))))
;(add-to-hook 'find-file-hook (lambda () (when (bound-and-true-p conda-project-env-path)
;                                          (conda-env-activate-for-buffer))))


;; company
;; Completion hooks
;; ;;;;;;;;;;;;;;;;;;;;
(defun my/company-backends-for-current-buffer ()
  "Return Company backends appropriate for the current buffer."
  (let ((backends '(company-capf
                    company-files
                    company-dabbrev-code)))
    (when (derived-mode-p 'qml-mode)
      (require 'company-qml nil t)
      (when (fboundp 'company-qml)
        (setq backends (append backends '(company-qml)))))
    (list backends)))

(defun my/company-setup ()
  "Prefer capf-driven completion in programming buffers."
  (setq-local company-backends (my/company-backends-for-current-buffer))
  (setq-local company-transformers nil))

(use-package company
  :ensure t
  :demand t
  :hook
  (after-init . global-company-mode)
  (prog-mode . my/company-setup)
  (json-mode . my/company-setup)
  (qml-mode . my/company-setup)
  (web-mode . my/company-setup)
  (eglot-managed-mode . my/company-setup)
  :bind (:map company-active-map
              ("TAB" . company-complete-selection)
              ("<tab>" . company-complete-selection)
              ("C-n" . company-select-next)
              ("C-p" . company-select-previous))
  :init
  (setq company-global-modes
        '(not gud-mode shell-mode eshell-mode term-mode vterm-mode eat-mode))
  :config
  (setq company-idle-delay 0.15)
  (setq company-minimum-prefix-length 1)
  (setq company-require-match 'never)
  (setq company-selection-wrap-around t)
  (setq company-tooltip-align-annotations t)
  (setq company-tooltip-limit 12)
  (setq company-dabbrev-downcase nil) ; completion in case-sensitive mode
  (setq company-dabbrev-ignore-case nil)
  (setq company-show-quick-access t))

;; add icons to company backends when child frames are available
(defun my/company-box-setup ()
  "Enable company-box in graphical sessions."
  (when (display-graphic-p)
    (company-box-mode 1)))

(use-package company-box
  :ensure t
  :after company
  :delight
  :hook (company-mode . my/company-box-setup))

;; company colors
(require 'color)

(defun my/company-apply-theme (&rest _)
  "Update Company faces to match the active theme."
  (let* ((bg (face-background 'default nil t))
         (base-bg (if (and (stringp bg) (color-defined-p bg))
                      bg
                    "#2b2b2b")))
    (custom-set-faces
     `(company-tooltip ((t (:inherit default :background ,(color-lighten-name base-bg 2)))))
     `(company-scrollbar-bg ((t (:background ,(color-lighten-name base-bg 10)))))
     `(company-scrollbar-fg ((t (:background ,(color-lighten-name base-bg 5)))))
     `(company-tooltip-selection ((t (:inherit font-lock-function-name-face))))
     `(company-tooltip-common ((t (:inherit font-lock-constant-face)))))))

(my/company-apply-theme)
(advice-add 'load-theme :after #'my/company-apply-theme)


;; cmake stuff
(use-package cmake-mode
  :ensure t
  :mode ("\\CMakeLists.txt\\'" "\\.cmake\\'"))

(use-package cmake-font-lock
  :ensure t
  :after (cmake-mode)
  :hook (cmake-mode . cmake-font-lock-activate))

;; flymake
;; ;;;;;;;;;;;;;;;;;;;
(use-package flymake
  :ensure t
  :defer t)


;; Customize flymake to show errors on minibuffer instead of popups
(setq flymake-gui-warnings-enabled nil)
(setq flymake-start-syntax-check-on-newline nil)
(setq flymake-no-changes-timeout nil)
(setq flymake-proc-compilation-prevents-echo t)

;; language servers / eglot
;; ;;;;;;;;;;;;;;;;;;;;;;;

(defvar my/clangd-executable-candidates
  '("clangd"
    "clangd-18"
    "clangd-17"
    "clangd-16"
    "clangd-15"
    "clangd-14"
    "clangd-13")
  "Candidate executable names for clangd.")

(defun my/find-executable (candidates)
  "Return the first executable found in CANDIDATES."
  (catch 'match
    (dolist (candidate candidates)
      (let ((path (cond
                   ((file-name-absolute-p candidate)
                    (and (file-executable-p candidate) candidate))
                   ((string-prefix-p "~/" candidate)
                    (let ((expanded (expand-file-name candidate)))
                      (and (file-executable-p expanded) expanded)))
                   (t
                    (executable-find candidate)))))
        (when path
          (throw 'match path))))))

(defun my/eglot-cpp-contact ()
  "Return the Eglot server command for C and C++ (clangd)."
  (let ((clangd (or (my/find-executable my/clangd-executable-candidates)
                    "clangd")))
    `(,clangd
      "--background-index"
      "--clang-tidy"
      "--completion-style=detailed"
      "--cross-file-rename"
      "--header-insertion=never"
      "--malloc-trim"
      "--pch-storage=memory")))

(use-package eglot
  :ensure nil
  :commands (eglot eglot-ensure)
  :hook ((rust-mode . eglot-ensure)
         (c-mode . eglot-ensure)
         (c-ts-mode . eglot-ensure)
         (c++-mode . eglot-ensure)
         (c++-ts-mode . eglot-ensure)
         (python-mode . eglot-ensure)
         (web-mode . eglot-ensure)       ; no linting
         (js-mode . eglot-ensure)
         (json-mode . eglot-ensure))      ; no linting)
  :bind (:map eglot-mode-map
              ("C-c l r" . eglot-rename)
              ("C-c l h" . eglot-help-at-point)
              ("C-c l a" . eglot-code-actions)
              ("M-n"     . flymake-goto-next-error)
              ("M-p"     . flymake-goto-prev-error))
  :init
  :custom
  ;; Shutdown server after buffer kill
  (eglot-autoshutdown t)
  ;; Enable eglot in code external to project
  (eglot-extend-to-xref t)
  :config
  (add-to-list 'eglot-server-programs
               '((c-mode c-ts-mode c++-mode c++-ts-mode) . my/eglot-cpp-contact))
  ; Add server for web-mode
  ;(add-to-list 'eglot-server-programs
  ;             '(web-mode . ("vscode-html-language-server" "--stdio")))

  (add-to-list 'eglot-server-programs
               '(python-mode . ("pyright-langserver" "--stdio")))
  ;;(add-to-list 'eglot-server-programs
  ;;             '(python-mode . ("jedi-language-server"))))
)



(use-package yasnippet
  :ensure t
  :config (yas-global-mode 1))

;; terminal emulator
;; ;;;;;;;;;;;;;;;;;;;;
(use-package eat
  :ensure t
  :commands (eat)
  :init
  (setq eat-term-terminfo-directory
        (expand-file-name "terminfo"
                          (if (boundp 'my/emacs-config-directory)
                              my/emacs-config-directory
                            user-emacs-directory)))
  :config
  (defun my/eat-send-backspace ()
    "Send a terminal backspace from an Eat buffer."
    (interactive)
    (eat-self-input 1 'backspace))

  ;; macOS Emacs may report the physical Delete key as <delete>, while
  ;; shells expect DEL/backspace for backward character deletion.
  (define-key eat-char-mode-map (kbd "<delete>") #'my/eat-send-backspace)
  (define-key eat-semi-char-mode-map (kbd "<delete>") #'my/eat-send-backspace))

;; neotree
;; ;;;;;;;;;;;;;;;;;;;;
(use-package neotree
 :ensure t)
(global-set-key (kbd "C-c n") #'neotree-toggle)


;; Pi coding agent
;; ;;;;;;;;;;;;;;;;;;;;
(require 'term)

(defun my/pi-agent--command (continue-last-session)
  "Return the shell command used to launch Pi.
CONTINUE-LAST-SESSION controls whether Pi should resume the previous session."
  (concat (shell-quote-argument (executable-find "pi"))
          (when continue-last-session " -c")))

(defun my/pi-agent--pop-to-bottom (buffer)
  "Show BUFFER with point at the end of the terminal output."
  (let ((window (pop-to-buffer buffer)))
    (with-current-buffer buffer
      (goto-char (point-max))
      (when-let ((process (get-buffer-process buffer)))
        (set-marker (process-mark process) (point-max))
        (set-marker-insertion-type (process-mark process) t)))
    (set-window-point window (with-current-buffer buffer (point-max)))))

(defun my/pi-agent--enable-follow-output ()
  "Keep the Pi terminal following new process output."
  (setq-local term-scroll-to-bottom-on-output t)
  (setq-local term-scroll-show-maximum-output t)
  (when (boundp 'eat-scroll-to-bottom-on-output)
    (setq-local eat-scroll-to-bottom-on-output t))
  (when (boundp 'eat-scroll-to-bottom-on-input)
    (setq-local eat-scroll-to-bottom-on-input t)))

(defun my/pi-agent--start-in-eat (command)
  "Start Pi using Eat with COMMAND."
  (let ((current-prefix-arg '(4)))
    (call-interactively #'eat))
  (let ((buffer (current-buffer)))
    (rename-buffer "*pi*" t)
    (my/pi-agent--enable-follow-output)
    (when (fboundp 'eat-char-mode)
      (eat-char-mode))
    (when-let ((process (get-buffer-process buffer)))
      (process-send-string process (concat command "\n")))
    (my/pi-agent--pop-to-bottom buffer)))

(defun my/pi-agent--start-in-ansi-term (shell command)
  "Start Pi using `ansi-term' with SHELL and COMMAND."
  (let* ((process-environment (cons "TERM=xterm-256color" process-environment))
         (term-buffer (ansi-term shell "pi")))
    (with-current-buffer term-buffer
      (rename-buffer "*pi*" t)
      (my/pi-agent--enable-follow-output)
      (term-char-mode)
      (term-send-raw-string (concat command "\n")))
    (my/pi-agent--pop-to-bottom term-buffer)))

(defun my/pi-agent (&optional continue-last-session)
  "Launch Pi in a dedicated terminal buffer.
With prefix argument CONTINUE-LAST-SESSION, resume the last Pi session."
  (interactive "P")
  (let* ((pi-command (executable-find "pi"))
         (project-root (or (and (fboundp 'projectile-project-root)
                                (ignore-errors (projectile-project-root)))
                           default-directory))
         (default-directory project-root)
         (buffer-name "*pi*")
         (command nil)
         (shell (or explicit-shell-file-name
                    (getenv "SHELL")
                    "/bin/bash")))
    (unless pi-command
      (user-error
       "Pi executable not found. Install with: npm install -g @mariozechner/pi-coding-agent"))
    (setq command (my/pi-agent--command continue-last-session))
    (let ((buffer (get-buffer buffer-name)))
      (if (and buffer (get-buffer-process buffer))
          (my/pi-agent--pop-to-bottom buffer)
        (when buffer
          (kill-buffer buffer))
        (cond
         ((fboundp 'eat)
          (my/pi-agent--start-in-eat command))
         (t
          (my/pi-agent--start-in-ansi-term shell command)))))))

(global-set-key (kbd "C-c P") #'my/pi-agent)

(with-eval-after-load 'projectile
  (define-key projectile-command-map (kbd "P") #'my/pi-agent))
