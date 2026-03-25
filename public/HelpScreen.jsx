import React, { useState } from 'react';
import axios from 'axios';
import { ArrowLeft, HelpCircle, Mail, FileText, Shield, ChevronRight, Send } from 'lucide-react';

const HelpScreen = ({ onBack, userId, userName, phone }) => {
    const [showContactForm, setShowContactForm] = useState(false);
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmitReport = async () => {
        if (!message.trim()) return;
        setSubmitting(true);
        try {
            await axios.post('/api/reports/submit', {
                userId,
                userName,
                phone,
                reason: 'HELP_REQUEST',
                message
            });
            alert('Your report has been submitted. Our team will review it shortly.');
            setMessage('');
            setShowContactForm(false);
        } catch (err) {
            alert('Failed to submit report. Please try again later.');
        } finally {
            setSubmitting(false);
        }
    };

    if (showContactForm) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f0f2f5' }}>
                <div style={{ padding: '16px 20px', backgroundColor: '#fff', borderBottom: '1px solid #e9edef', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <ArrowLeft size={24} onClick={() => setShowContactForm(false)} style={{ cursor: 'pointer', color: '#111b21' }} />
                    <span style={{ fontSize: '20px', fontWeight: '500', color: '#111b21' }}>Contact Support</span>
                </div>
                
                <div style={{ padding: '20px', backgroundColor: '#fff', marginTop: '8px', flex: 1 }}>
                    <p style={{ color: '#667781', fontSize: '14px', marginBottom: '20px' }}>
                        Describe your issue or feedback in detail. Include screenshots if possible (feature coming soon).
                    </p>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Tell us how we can help..."
                        style={{
                            width: '100%',
                            height: '200px',
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid #e9edef',
                            backgroundColor: '#f8f9fa',
                            fontSize: '16px',
                            resize: 'none',
                            outline: 'none'
                        }}
                    />
                    <button
                        onClick={handleSubmitReport}
                        disabled={submitting || !message.trim()}
                        style={{
                            width: '100%',
                            marginTop: '20px',
                            padding: '14px',
                            backgroundColor: submitting ? '#f0f2f5' : '#00a884',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '24px',
                            fontSize: '16px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            cursor: 'pointer'
                        }}
                    >
                        {submitting ? 'Submitting...' : <><Send size={18} /> Send Message</>}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f0f2f5' }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                backgroundColor: '#fff',
                borderBottom: '1px solid #e9edef',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
            }}>
                <ArrowLeft size={24} onClick={onBack} style={{ cursor: 'pointer', color: '#111b21' }} />
                <span style={{ fontSize: '20px', fontWeight: '500', color: '#111b21' }}>Help</span>
            </div>

            {/* Help Options */}
            <div style={{ backgroundColor: '#fff', marginTop: '8px' }}>
                <HelpOption
                    icon={<Mail size={22} color="#00a884" />}
                    title="Contact us"
                    subtitle="Questions? Need help?"
                    onClick={() => setShowContactForm(true)}
                />
            </div>

            {/* App Info */}
            <div style={{
                marginTop: '24px',
                padding: '20px',
                textAlign: 'center',
                color: '#8696a0'
            }}>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>Whatsup</p>
                <p style={{ fontSize: '13px', marginBottom: '4px' }}>Version 1.0.0</p>
                <p style={{ fontSize: '12px' }}>© 2026 Tejsh. All rights reserved.</p>
            </div>
        </div>
    );
};

const HelpOption = ({ icon, title, subtitle, onClick }) => (
    <div
        onClick={onClick}
        style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            borderBottom: '1px solid #f0f2f5',
            transition: 'background-color 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f6f6'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
    >
        <div style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
            {icon}
        </div>
        <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', color: '#111b21' }}>{title}</div>
            {subtitle && <div style={{ fontSize: '14px', color: '#667781', marginTop: '2px' }}>{subtitle}</div>}
        </div>
        <ChevronRight size={20} color="#8696a0" />
    </div>
);

export default HelpScreen;
