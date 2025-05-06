document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing script...');
  
  // Set current year in footer
  document.getElementById('currentYear').textContent = new Date().getFullYear();
  
  // Load ports and container types
  await loadPorts();
  await loadContainerTypes();
  
  // Set up form submission
  const form = document.getElementById('calculatorForm');
  form.addEventListener('submit', handleFormSubmit);
});

// Load ports from API
async function loadPorts() {
  console.log('Loading ports from /api/public/ports...');
  try {
    const response = await fetch('/api/public/ports'); // MODIFIED
    if (!response.ok) {
      throw new Error('Failed to fetch ports');
    }
    
    const ports = await response.json();
    console.log('Ports loaded:', ports);
    
    // Group ports by region
    const portsByRegion = {};
    ports.forEach(port => {
      if (!portsByRegion[port.region]) {
        portsByRegion[port.region] = [];
      }
      portsByRegion[port.region].push(port);
    });
    
    // Populate origin and destination dropdowns
    const originSelect = document.getElementById('origin');
    const destinationSelect = document.getElementById('destination');
    
    // Clear existing options except the first one
    originSelect.innerHTML = '<option value="">Select origin port</option>';
    destinationSelect.innerHTML = '<option value="">Select destination port</option>';
    
    // Add ports grouped by region
    Object.entries(portsByRegion).forEach(([region, regionPorts]) => {
      const originGroup = document.createElement('optgroup');
      originGroup.label = region;
      
      const destinationGroup = document.createElement('optgroup');
      destinationGroup.label = region;
      
      regionPorts.forEach(port => {
        // Create option for origin
        const originOption = document.createElement('option');
        originOption.value = port.id; // Using ID as value, as per original script logic
        originOption.textContent = `${port.name}, ${port.country} (${port.code || port.id})`; // Display name, country, and code/id
        originGroup.appendChild(originOption);
        
        // Create option for destination
        const destinationOption = document.createElement('option');
        destinationOption.value = port.id; // Using ID as value
        destinationOption.textContent = `${port.name}, ${port.country} (${port.code || port.id})`;
        destinationGroup.appendChild(destinationOption);
      });
      
      originSelect.appendChild(originGroup);
      destinationSelect.appendChild(destinationGroup);
    });
  } catch (error) {
    console.error('Error loading ports:', error);
    alert('Failed to load ports. Please refresh the page and try again.');
  }
}

// Load container types from API
async function loadContainerTypes() {
  console.log('Loading container types from /api/public/container-types...');
  try {
    const response = await fetch('/api/public/container-types'); // MODIFIED
    if (!response.ok) {
      throw new Error('Failed to fetch container types');
    }
    
    const containerTypes = await response.json();
    console.log('Container types loaded:', containerTypes);
    
    const containerTypeSelect = document.getElementById('containerType');
    
    // Clear existing options except the first one
    containerTypeSelect.innerHTML = '<option value="">Select container type</option>';
    
    // Add container types
    containerTypes.forEach(containerType => {
      const option = document.createElement('option');
      option.value = containerType.name; // Using name as value, as per original script logic for calculation
      option.textContent = `${containerType.name} - ${containerType.description || ''}`;
      containerTypeSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading container types:', error);
    alert('Failed to load container types. Please refresh the page and try again.');
  }
}

// Handle form submission
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalButtonText = submitButton.textContent;
  
  // Show loading state
  submitButton.textContent = 'Calculating...';
  submitButton.disabled = true;
  
  try {
    // Get form data
    const formData = new FormData(form);
    const data = {
      originPort: formData.get('origin'), // This will be port ID
      destinationPort: formData.get('destination'), // This will be port ID
      containerType: formData.get('containerType'), // This will be container type name
      weight: 20000, // Добавляем стандартный вес 20 тонн
      email: formData.get('email')
    };
    
    console.log('Sending data to API for calculation:', data);
    
    // Call API to calculate rate
    const response = await fetch('/api/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to calculate rate: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    console.log('API response for calculation:', result);
    
    // Display results
    displayResults(data, result);
  } catch (error) {
    console.error('Error during calculation:', error);
    alert(`An error occurred while calculating the rate: ${error.message}`);
  } finally {
    // Reset button
    submitButton.textContent = originalButtonText;
    submitButton.disabled = false;
  }
}

// Display calculation results
function displayResults(data, result) {
  console.log('Displaying results:', result);
  
  // Get port and container names
  const originSelect = document.getElementById('origin');
  const destinationSelect = document.getElementById('destination');
  const containerTypeSelect = document.getElementById('containerType');
  
  const originOption = originSelect.options[originSelect.selectedIndex];
  const destinationOption = destinationSelect.options[destinationSelect.selectedIndex];
  const containerTypeOption = containerTypeSelect.options[containerTypeSelect.selectedIndex];
  
  // Update display elements
  document.getElementById('routeDisplay').textContent = `${originOption.textContent.split(' (')[0]} → ${destinationOption.textContent.split(' (')[0]}`;
  document.getElementById('containerDisplay').textContent = containerTypeOption.textContent.split(' - ')[0];
  document.getElementById('dateDisplay').textContent = new Date().toLocaleDateString();
  
  const minRateValue = result.rateDetails?.minRate || result.minRate || result.min_rate || 0;
  const maxRateValue = result.rateDetails?.maxRate || result.maxRate || result.max_rate || 0;
  let avgRateValue = result.rate || result.rateDetails?.finalRate || result.avgRate || result.avg_rate || 0;

  if (avgRateValue === 0 && (minRateValue !== 0 || maxRateValue !== 0)) {
    avgRateValue = Math.round((parseFloat(minRateValue) + parseFloat(maxRateValue)) / 2);
  }
  
  console.log('Rate values for display:', { minRateValue, maxRateValue, avgRateValue });
  
  document.getElementById('minRate').textContent = `$${minRateValue}`;
  document.getElementById('maxRate').textContent = `$${maxRateValue}`;
  
  const rateIndicatorContainer = document.querySelector('.mb-4');
  if (rateIndicatorContainer) {
    rateIndicatorContainer.innerHTML = `
      <p class="text-sm text-gray-500 mb-1">Rate Range (USD)</p>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">Min: $${minRateValue}</span>
        <span class="text-sm font-medium bg-blue-600 text-white px-3 py-1 rounded">Avg: $${avgRateValue}</span>
        <span class="text-sm font-medium">Max: $${maxRateValue}</span>
      </div>
    `;
  } else {
    console.error('Rate indicator container not found');
    const avgRateElement = document.getElementById('avgRate');
    if (avgRateElement) {
      avgRateElement.textContent = `$${avgRateValue}`;
      avgRateElement.style.fontWeight = 'bold';
      avgRateElement.style.color = 'white';
      avgRateElement.style.backgroundColor = '#2563eb';
      avgRateElement.style.padding = '4px 8px';
      avgRateElement.style.borderRadius = '4px';
      const parentElement = avgRateElement.parentElement;
      if (parentElement) {
        parentElement.style.visibility = 'visible';
        parentElement.style.display = 'block';
      }
    } else {
      console.error('avgRate element not found in DOM');
    }
  }
  
  const sourceCountElement = document.getElementById('sourceCount');
  if (sourceCountElement) {
    sourceCountElement.textContent = result.rateDetails?.sourceCount || result.sourceCount || result.source_count || '3';
  }
  
  const reliabilityElement = document.getElementById('reliability');
  if (reliabilityElement) {
    let reliabilityValue = result.rateDetails?.reliabilityScore || result.reliability || result.reliability_score || 0.85;
    if (typeof reliabilityValue === 'number') {
      reliabilityValue = `${Math.round(reliabilityValue * 100)}%`;
    } else if (reliabilityValue && !reliabilityValue.toString().includes('%')) {
      reliabilityValue = `${reliabilityValue}%`;
    }
    reliabilityElement.textContent = reliabilityValue;
  }
  
  const resultContainer = document.getElementById('resultContainer');
  if (resultContainer) {
    resultContainer.classList.remove('hidden');
    resultContainer.scrollIntoView({ behavior: 'smooth' });
  } else {
    console.error('resultContainer element not found in DOM');
  }
}

