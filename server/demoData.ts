import type { ItemDifficulty } from '../src/types/auction.ts';

export interface DemoItemSeed {
  id: string;
  name: string;
  imageUrl: string;
  emoji: string;
  category: string;
  description: string;
  startingBid: number;
  difficulty: ItemDifficulty;
  question: string;
  correctAnswer: string;
  explanation: string;
  timeLimitOverrideSec: number | null;
  hostNotes: string;
}

export const DEMO_ROOM_ID = 'demo-room-techithon-2026';
export const DEMO_ROOM_CODE = 'TECH26';

export const DEMO_ITEMS: DemoItemSeed[] = [
  {
    id: 'demo-item-01-raspberry-pi',
    name: 'Raspberry Pi',
    imageUrl: '/src/assets/images/tech_raspberry_pi_1795603755543.jpg',
    emoji: '🍓',
    category: 'Embedded Systems',
    description: 'A compact credit-card-sized single-board computer used for programming, Linux computing, and electronics prototyping.',
    startingBid: 10,
    difficulty: 'Easy',
    question: 'Do the standard Raspberry Pi GPIO pins provide native analog input?',
    correctAnswer: 'No. An external ADC (Analog-to-Digital Converter) is required for analog input.',
    explanation: 'Standard Raspberry Pi GPIO pins only read and write digital HIGH/LOW signals. Reading analog sensors requires an external ADC chip such as the MCP3008.',
    timeLimitOverrideSec: null,
    hostNotes: 'Accept answers mentioning external ADC or digital-only GPIO pins.'
  },
  {
    id: 'demo-item-02-arduino-uno',
    name: 'Arduino Uno',
    imageUrl: '/src/assets/images/tech_arduino_uno_1795603756456.jpg',
    emoji: '🔌',
    category: 'Microcontrollers',
    description: 'An open-source microcontroller development board built around the ATmega328P chip for interactive hardware projects.',
    startingBid: 10,
    difficulty: 'Easy',
    question: 'How many analog input pins does a standard Arduino Uno R3 board have, and what is its ADC resolution?',
    correctAnswer: '6 analog input pins (A0 to A5) with 10-bit ADC resolution (0 to 1023).',
    explanation: 'The ATmega328P on the Arduino Uno routes 6 analog channels (A0–A5) through a 10-bit analog-to-digital converter.',
    timeLimitOverrideSec: null,
    hostNotes: 'Award credit if the team correctly states 6 analog pins (A0–A5) and 10-bit resolution.'
  },
  {
    id: 'demo-item-03-cpu',
    name: 'Central Processing Unit (CPU)',
    imageUrl: '/src/assets/images/tech_cpu_processor_1795603757284.jpg',
    emoji: '🧠',
    category: 'Computer Architecture',
    description: 'The primary microprocessor that executes program instructions via arithmetic, logic, control, and I/O operations.',
    startingBid: 15,
    difficulty: 'Easy',
    question: 'What are the three main repeating stages of the CPU instruction cycle?',
    correctAnswer: 'Fetch, Decode, and Execute.',
    explanation: 'The control unit fetches an instruction from memory, decodes the opcode, and the ALU/registers execute the instruction.',
    timeLimitOverrideSec: null,
    hostNotes: 'Also accept Fetch-Decode-Execute-Writeback.'
  },
  {
    id: 'demo-item-04-gpu',
    name: 'Graphics Processing Unit (GPU)',
    imageUrl: '/src/assets/images/tech_gpu_graphics_1795603756319.jpg',
    emoji: '🎮',
    category: 'Hardware & AI',
    description: 'A massively parallel processor specialized for 3D rendering, matrix multiplication, and deep learning workloads.',
    startingBid: 20,
    difficulty: 'Medium',
    question: 'Why are GPUs dramatically faster than CPUs at training neural networks?',
    correctAnswer: 'GPUs have thousands of smaller cores optimized for parallel matrix and vector operations.',
    explanation: 'While CPUs optimize low-latency sequential execution across a few powerful cores, GPUs excel at high-throughput SIMD parallel math.',
    timeLimitOverrideSec: null,
    hostNotes: 'Look for parallel processing / thousands of cores / matrix multiplication.'
  },
  {
    id: 'demo-item-05-iot',
    name: 'Internet of Things (IoT)',
    imageUrl: '/src/assets/images/tech_cloud_iot_1795603756726.jpg',
    emoji: '📡',
    category: 'Connectivity',
    description: 'A network of physical devices embedded with sensors, firmware, and wireless radios that exchange real-time telemetry.',
    startingBid: 15,
    difficulty: 'Medium',
    question: 'Which lightweight publish/subscribe messaging protocol is most widely used by constrained IoT sensors?',
    correctAnswer: 'MQTT (Message Queuing Telemetry Transport).',
    explanation: 'MQTT runs over TCP/IP with minimal packet overhead, making it ideal for battery-powered sensors and unreliable networks.',
    timeLimitOverrideSec: null,
    hostNotes: 'Accept MQTT (or CoAP if justified for UDP).'
  },
  {
    id: 'demo-item-06-smartphone',
    name: 'Smartphone',
    imageUrl: '',
    emoji: '📱',
    category: 'Consumer Tech',
    description: 'A pocket-sized mobile computer integrating a System-on-Chip (SoC), multi-touch display, radios, and MEMS sensors.',
    startingBid: 10,
    difficulty: 'Easy',
    question: 'Which sensor inside a smartphone detects angular rotation and orientation changes around three axes?',
    correctAnswer: 'Gyroscope (often paired with an accelerometer in an IMU).',
    explanation: 'A MEMS gyroscope measures angular velocity around pitch, roll, and yaw axes, while an accelerometer measures linear acceleration.',
    timeLimitOverrideSec: null,
    hostNotes: 'Gyroscope is required; accelerometer alone measures linear acceleration/tilt.'
  },
  {
    id: 'demo-item-07-keyboard-mouse',
    name: 'Keyboard and Mouse',
    imageUrl: '',
    emoji: '⌨️',
    category: 'Peripherals',
    description: 'Primary human-interface input devices translating keystrokes and optical surface tracking into digital coordinates.',
    startingBid: 5,
    difficulty: 'Easy',
    question: 'What does DPI stand for on a computer mouse, and what does a higher DPI mean?',
    correctAnswer: 'Dots Per Inch — higher DPI means the cursor moves farther on screen per inch of physical mouse movement.',
    explanation: 'DPI measures optical sensor sensitivity per linear inch of travel across a desk.',
    timeLimitOverrideSec: null,
    hostNotes: 'Require both expansion (Dots Per Inch) and practical meaning.'
  },
  {
    id: 'demo-item-08-pen-drive',
    name: 'USB Pen Drive',
    imageUrl: '',
    emoji: '💾',
    category: 'Storage',
    description: 'A portable solid-state flash memory drive interfacing over Universal Serial Bus for quick file transfer.',
    startingBid: 5,
    difficulty: 'Easy',
    question: 'Is NAND flash memory inside a pen drive volatile or non-volatile storage, and why?',
    correctAnswer: 'Non-volatile, because it retains stored data even when electrical power is removed.',
    explanation: 'NAND flash stores charge in floating-gate or charge-trap transistors, preserving bits without continuous power.',
    timeLimitOverrideSec: null,
    hostNotes: 'Simple direct question for first-year students.'
  },
  {
    id: 'demo-item-09-wifi-router',
    name: 'Wi-Fi Router',
    imageUrl: '',
    emoji: '📶',
    category: 'Networking',
    description: 'A networking gateway that routes IP packets between local wireless devices and the wider internet.',
    startingBid: 10,
    difficulty: 'Medium',
    question: 'What is the key trade-off between the 2.4 GHz and 5 GHz Wi-Fi frequency bands?',
    correctAnswer: '2.4 GHz travels farther through walls with lower speed; 5 GHz delivers higher speed over shorter range.',
    explanation: 'Lower frequency waves attenuate less through obstacles, while wider 5 GHz channels provide higher throughput and less interference.',
    timeLimitOverrideSec: null,
    hostNotes: 'Look for range vs speed trade-off.'
  },
  {
    id: 'demo-item-10-bluetooth',
    name: 'Bluetooth Module',
    imageUrl: '',
    emoji: '🎧',
    category: 'Wireless Tech',
    description: 'A short-range wireless standard operating in the 2.4 GHz ISM band for personal area networks and wearables.',
    startingBid: 10,
    difficulty: 'Medium',
    question: 'What does BLE stand for, and what is its main advantage over Classic Bluetooth?',
    correctAnswer: 'Bluetooth Low Energy — drastically lower power consumption for small intermittent data packets.',
    explanation: 'BLE sleeps between short advertising or connection intervals, allowing coin-cell sensors to run for months or years.',
    timeLimitOverrideSec: null,
    hostNotes: 'Key words: Bluetooth Low Energy + power efficiency.'
  },
  {
    id: 'demo-item-11-ram',
    name: 'DDR5 RAM Module',
    imageUrl: '',
    emoji: '⚡',
    category: 'Memory',
    description: 'High-speed volatile primary memory holding active operating system instructions and running program data.',
    startingBid: 15,
    difficulty: 'Easy',
    question: 'What happens to data stored in RAM when a computer loses power, and why do we still use RAM instead of only SSDs?',
    correctAnswer: 'Data is lost (volatile), and we use RAM because it is orders of magnitude faster for CPU read/write access.',
    explanation: 'DRAM provides nanosecond-scale random access latency compared to microsecond/millisecond flash storage.',
    timeLimitOverrideSec: null,
    hostNotes: 'Both parts (volatility + speed) needed.'
  },
  {
    id: 'demo-item-12-ssd',
    name: 'NVMe Solid State Drive (SSD)',
    imageUrl: '',
    emoji: '💿',
    category: 'Storage',
    description: 'A high-speed non-volatile storage drive using PCIe lanes and flash memory with no moving mechanical parts.',
    startingBid: 15,
    difficulty: 'Medium',
    question: 'Why is an NVMe SSD connected over PCIe much faster than a traditional SATA SSD?',
    correctAnswer: 'NVMe communicates directly over high-bandwidth PCIe lanes with thousands of parallel command queues.',
    explanation: 'SATA is capped around 600 MB/s with a single 32-command queue, while NVMe supports 64K queues and multi-GB/s PCIe bandwidth.',
    timeLimitOverrideSec: null,
    hostNotes: 'Accept PCIe direct lane / lower latency / parallel queues.'
  },
  {
    id: 'demo-item-13-qr-code',
    name: 'QR Code Matrix',
    imageUrl: '',
    emoji: '🏁',
    category: 'Information Systems',
    description: 'A two-dimensional matrix barcode encoding URLs, identifiers, or payload data with built-in error correction.',
    startingBid: 5,
    difficulty: 'Medium',
    question: 'What do the three large squares in the corners of a QR code help a camera scanner do?',
    correctAnswer: 'Detect the position, orientation, and skew angle of the QR code instantly.',
    explanation: 'These three finder patterns allow scanners to orient the 2D grid accurately even when tilted or upside down.',
    timeLimitOverrideSec: null,
    hostNotes: 'Accept finder patterns / orientation / alignment detection.'
  },
  {
    id: 'demo-item-14-machine-learning',
    name: 'Machine Learning Engine',
    imageUrl: '',
    emoji: '🤖',
    category: 'Artificial Intelligence',
    description: 'Algorithms that learn patterns and decision boundaries directly from training data rather than explicit rules.',
    startingBid: 20,
    difficulty: 'Hard',
    question: 'What is "overfitting" in a machine learning model?',
    correctAnswer: 'When a model memorizes noise in training data, achieving high training accuracy but poor accuracy on unseen test data.',
    explanation: 'Overfitting occurs when model complexity exceeds the signal in the training set, hurting generalization.',
    timeLimitOverrideSec: null,
    hostNotes: 'Must mention high training performance vs poor generalization on new/test data.'
  },
  {
    id: 'demo-item-15-cloud-computing',
    name: 'Cloud Computing Cluster',
    imageUrl: '',
    emoji: '☁️',
    category: 'Distributed Systems',
    description: 'On-demand delivery of compute, storage, and networking resources over the internet with elastic scaling.',
    startingBid: 20,
    difficulty: 'Hard',
    question: 'Explain the core difference between IaaS, PaaS, and SaaS with one example of each.',
    correctAnswer: 'IaaS provides virtual infrastructure (e.g., AWS EC2), PaaS provides managed app runtime (e.g., Heroku/App Engine), SaaS provides ready-to-use software (e.g., Gmail).',
    explanation: 'Each tier abstracts more operational management away from the customer, from raw virtual machines up to end-user applications.',
    timeLimitOverrideSec: null,
    hostNotes: 'Require clear distinction + valid examples.'
  }
];
